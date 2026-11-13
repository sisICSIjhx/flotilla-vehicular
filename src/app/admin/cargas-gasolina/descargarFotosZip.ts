// Descarga en un ZIP las fotos (odómetro, tablero después de la carga y/o ticket,
// según los tipos elegidos) de las cargas de gasolina filtradas. Cada foto se nombra con el vehículo
// y la fecha de la carga: VEH015_Apodo_2026-11-05_1430_ticket.jpg

import { format } from 'date-fns'
import { descargarFotoCarga } from '@/utils/storage'
import { descargarBlob, nombreArchivo } from '@/utils/export/download'
import { type CargaGasolina } from '@/app/historico/types'

export const TIPOS_FOTO = [
  { tipo: 'odometro', campo: 'foto_tablero_antes_path', sufijo: 'odometro', label: 'Odómetro (antes)' },
  { tipo: 'carga', campo: 'foto_tablero_despues_path', sufijo: 'carga', label: 'Tablero (después)' },
  { tipo: 'ticket', campo: 'foto_ticket_path', sufijo: 'ticket', label: 'Ticket' },
] as const

export type TipoFoto = (typeof TIPOS_FOTO)[number]['tipo']

export const TODOS_TIPOS_FOTO: TipoFoto[] = TIPOS_FOTO.map(t => t.tipo)

const DESCARGAS_SIMULTANEAS = 5

interface FotoZip {
  path: string
  nombre: string
  fecha: Date
}

/** Deja solo caracteres seguros para nombres de archivo (sin acentos ni espacios). */
function limpiarNombre(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function extensionDe(path: string): string {
  const m = path.match(/\.([A-Za-z0-9]{2,5})$/)
  return m ? m[1].toLowerCase() : 'jpg'
}

/** Lista las fotos existentes de las cargas (solo los tipos indicados), con nombre de archivo único. */
export function listarFotosCargas(
  cargas: CargaGasolina[],
  tipos: readonly TipoFoto[] = TODOS_TIPOS_FOTO
): FotoZip[] {
  const usados = new Map<string, number>()
  const fotos: FotoZip[] = []
  const seleccion = TIPOS_FOTO.filter(t => tipos.includes(t.tipo))

  for (const c of cargas) {
    const fecha = new Date(c.fecha_carga)
    const vehiculo = limpiarNombre([c.vehiculo_codigo, c.apodo].filter(Boolean).join('_'))
    const prefijo = `${vehiculo}_${format(fecha, 'yyyy-MM-dd_HHmm')}`

    for (const { campo, sufijo } of seleccion) {
      const path = c[campo]
      if (!path) continue

      // Dos cargas del mismo vehículo en el mismo minuto: se numera la repetida
      const base = `${prefijo}_${sufijo}`
      const repeticiones = (usados.get(base) ?? 0) + 1
      usados.set(base, repeticiones)
      const nombre = `${repeticiones > 1 ? `${base}_${repeticiones}` : base}.${extensionDe(path)}`

      fotos.push({ path, nombre, fecha })
    }
  }

  return fotos
}

export interface ResultadoFotosZip {
  total: number
  fallidas: number
}

/**
 * Descarga las fotos de las cargas y genera un ZIP.
 * `base` es el nombre del archivo sin extensión ni marca de tiempo.
 */
export async function descargarFotosZip(
  cargas: CargaGasolina[],
  base: string,
  tipos: readonly TipoFoto[],
  onProgreso?: (hechas: number, total: number) => void
): Promise<ResultadoFotosZip> {
  if (tipos.length === 0) throw new Error('Selecciona al menos un tipo de foto.')
  const fotos = listarFotosCargas(cargas, tipos)
  if (fotos.length === 0) throw new Error('Las cargas filtradas no tienen fotos de los tipos seleccionados.')

  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const fallidas: string[] = []
  let siguiente = 0
  let hechas = 0

  async function trabajador() {
    while (siguiente < fotos.length) {
      const foto = fotos[siguiente++]
      try {
        const blob = await descargarFotoCarga(foto.path)
        zip.file(foto.nombre, blob, { date: foto.fecha })
      } catch {
        fallidas.push(foto.nombre)
      }
      hechas++
      onProgreso?.(hechas, fotos.length)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(DESCARGAS_SIMULTANEAS, fotos.length) }, () => trabajador())
  )

  if (fallidas.length === fotos.length) {
    throw new Error('No se pudo descargar ninguna foto. Revisa la conexión e intenta de nuevo.')
  }
  if (fallidas.length > 0) {
    zip.file('_fotos_no_descargadas.txt', fallidas.sort().join('\r\n'))
  }

  // Las fotos ya son JPG comprimidos: se guardan sin recomprimir (más rápido)
  const contenido = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  descargarBlob(contenido, nombreArchivo(base, 'zip'))

  return { total: fotos.length, fallidas: fallidas.length }
}
