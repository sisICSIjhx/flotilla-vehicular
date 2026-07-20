import imageCompression from 'browser-image-compression'

const MAX_LADO = 1280
const MAX_BYTES = 0.3 * 1024 * 1024
const CALIDADES = [0.7, 0.55, 0.4, 0.3]

/**
 * Descarta rápido lo que claramente no es HEIC, para no bajar el decodificador
 * WASM (~3 MB) sin necesidad. El tipo puede venir vacío desde la galería de
 * Android, así que en ese caso sí se deja pasar a la comprobación real.
 */
function pareceHeic(file: File): boolean {
  if (/hei[cf]/i.test(file.type)) return true
  if (/\.hei[cf]$/i.test(file.name)) return true
  return !file.type || file.type === 'application/octet-stream'
}

/**
 * Decodifica HEIC/HEIF con libheif compilado a WASM. Solo lo usan los
 * navegadores que no traen decodificador propio (Chrome en Android y
 * escritorio); Safari nunca llega aquí porque resuelve antes por la vía nativa.
 * La carga es dinámica para que el peso lo pague únicamente quien lo necesita.
 */
async function decodificarHeic(file: File): Promise<ImageBitmap> {
  const { isHeic, heicTo } = await import('heic-to/next')
  if (!(await isHeic(file))) {
    throw new Error('el archivo no es HEIC')
  }
  return await heicTo({ blob: file, type: 'bitmap' })
}

/**
 * Decodifica el archivo a un bitmap. Se prefiere createImageBitmap porque
 * decodifica fuera del hilo principal y soporta formatos (HEIC en Safari) que
 * el decodificador de <img> rechaza. Si falla y el archivo parece HEIC, se
 * recurre al decodificador WASM. El fallback con <img> cubre navegadores
 * viejos que no exponen createImageBitmap.
 */
async function decodificar(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // Un archivo vacío casi siempre significa que el SO liberó el temporal de la
  // cámara: conviene decirlo tal cual en vez de hablar de "formato".
  if (file.size === 0) {
    throw new Error('el archivo quedó vacío; vuelve a tomar la foto')
  }

  let causaNativa: unknown = null
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch (err) {
      causaNativa = err
      // Safari < 15 no acepta el segundo argumento
      try {
        return await createImageBitmap(file)
      } catch (err2) {
        causaNativa = err2
      }
    }
  }

  if (pareceHeic(file)) {
    try {
      return await decodificarHeic(file)
    } catch (errHeic) {
      causaNativa = errHeic
    }
  }

  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      // El evento de error no trae mensaje: se conserva la causa nativa, que sí
      // distingue "no se pudo decodificar" de "no se pudo leer el archivo".
      img.onerror = () =>
        reject(
          new Error(
            causaNativa
              ? `no se pudo decodificar (${describir(causaNativa)})`
              : 'el navegador no pudo decodificar la imagen'
          )
        )
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function dimensiones(src: ImageBitmap | HTMLImageElement) {
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width
  const h = 'naturalHeight' in src ? src.naturalHeight : src.height
  const escala = Math.min(1, MAX_LADO / Math.max(w, h))
  return { w: Math.round(w * escala), h: Math.round(h * escala) }
}

function aBlob(canvas: HTMLCanvasElement, calidad: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', calidad))
}

async function comprimirNativo(file: File): Promise<File> {
  const bitmap = await decodificar(file)
  const { w, h } = dimensiones(bitmap)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no se pudo crear el contexto de dibujo')
  ctx.drawImage(bitmap, 0, 0, w, h)
  if ('close' in bitmap) bitmap.close()

  let ultimo: Blob | null = null
  for (const calidad of CALIDADES) {
    const blob = await aBlob(canvas, calidad)
    if (!blob) break
    ultimo = blob
    if (blob.size <= MAX_BYTES) break
  }

  // Liberar memoria del canvas en móviles antes de devolver.
  canvas.width = 0
  canvas.height = 0

  if (!ultimo) throw new Error('el navegador no pudo generar el JPEG')

  const nombre = file.name.replace(/\.[^.]+$/, '') || 'foto'
  return new File([ultimo], `${nombre}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  })
}

/**
 * Devuelve un archivo que el navegador sepa mostrar en un <img>. Solo hace algo
 * con HEIC/HEIF en navegadores sin decodificador propio: ahí Chrome pinta una
 * imagen rota y el usuario no ve lo que eligió. Si la vía nativa funciona
 * (Safari), se devuelve el archivo intacto y no se descarga nada.
 */
export async function normalizarImagen(file: File): Promise<File> {
  if (!pareceHeic(file)) return file

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      bitmap.close()
      return file
    } catch {
      // el navegador no sabe HEIC: se convierte abajo
    }
  }

  const { isHeic, heicTo } = await import('heic-to/next')
  if (!(await isHeic(file))) return file

  const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 })
  const nombre = file.name.replace(/\.[^.]+$/, '') || 'foto'
  return new File([blob], `${nombre}.jpg`, {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  })
}

function describir(err: unknown): string {
  if (err instanceof Error) return err.message
  // browser-image-compression rechaza con el evento DOM crudo (ProgressEvent),
  // que se serializa como "[object ProgressEvent]" y no dice nada al usuario.
  if (typeof Event !== 'undefined' && err instanceof Event) {
    return 'el navegador no pudo leer la imagen (formato no soportado o memoria insuficiente)'
  }
  return String(err)
}

export async function comprimirFoto(file: File): Promise<File> {
  try {
    return await comprimirNativo(file)
  } catch (errNativo) {
    try {
      return await imageCompression(file, {
        maxSizeMB: 0.3,
        maxWidthOrHeight: MAX_LADO,
        useWebWorker: false,
        fileType: 'image/jpeg',
        initialQuality: 0.7,
      })
    } catch (errLib) {
      // Los datos del archivo son lo que permite distinguir un formato no
      // soportado de un temporal de cámara que el SO ya liberó.
      const meta = `${file.type || 'sin tipo'}, ${Math.round(file.size / 1024)} KB`
      throw new Error(
        `Error al comprimir la foto (${meta}): ${describir(errNativo)} / respaldo: ${describir(errLib)}`
      )
    }
  }
}
