import imageCompression from 'browser-image-compression'

export async function comprimirFoto(file: File): Promise<File> {
  try {
    return await imageCompression(file, {
      maxSizeMB: 0.3,
      maxWidthOrHeight: 1280,
      useWebWorker: false,
      fileType: 'image/jpeg',
      initialQuality: 0.7,
    })
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err)
    throw new Error(`Error al comprimir la foto: ${detalle}`)
  }
}
