import { format } from 'date-fns'

/**
 * Dispara la descarga de un Blob en el navegador.
 */
export function descargarBlob(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Genera un nombre de archivo con marca de tiempo:
 * `historico_recorridos_2026-06-09_1430.csv`
 */
export function nombreArchivo(base: string, extension: string): string {
  return `${base}_${format(new Date(), 'yyyy-MM-dd_HHmm')}.${extension}`
}
