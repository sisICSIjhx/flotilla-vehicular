import { descargarBlob, nombreArchivo } from './download'

export type CeldaCsv = string | number | null | undefined

export interface SeccionCsv {
  titulo?: string
  encabezados: string[]
  filas: CeldaCsv[][]
}

/**
 * Escapa una celda según RFC 4180: comillas dobles y envoltura
 * cuando contiene separador, comillas o saltos de línea.
 */
function escaparCelda(celda: CeldaCsv): string {
  if (celda == null) return ''
  const texto = typeof celda === 'number' ? String(celda) : celda
  if (/[",\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`
  }
  return texto
}

function filasACsv(encabezados: string[], filas: CeldaCsv[][]): string {
  const lineas = [encabezados.map(escaparCelda).join(',')]
  for (const fila of filas) {
    lineas.push(fila.map(escaparCelda).join(','))
  }
  return lineas.join('\r\n')
}

/**
 * Genera y descarga un CSV simple (una sola tabla).
 * Incluye BOM UTF-8 para que Excel muestre acentos correctamente.
 */
export function descargarCsv(base: string, encabezados: string[], filas: CeldaCsv[][]) {
  const contenido = '\uFEFF' + filasACsv(encabezados, filas)
  descargarBlob(new Blob([contenido], { type: 'text/csv;charset=utf-8' }), nombreArchivo(base, 'csv'))
}

/**
 * Genera y descarga un CSV con varias secciones identificadas por título
 * (útil para exportar múltiples métricas en un solo archivo).
 */
export function descargarCsvSecciones(base: string, secciones: SeccionCsv[]) {
  const bloques = secciones.map((s) => {
    const titulo = s.titulo ? `${escaparCelda(s.titulo)}\r\n` : ''
    return titulo + filasACsv(s.encabezados, s.filas)
  })
  const contenido = '\uFEFF' + bloques.join('\r\n\r\n')
  descargarBlob(new Blob([contenido], { type: 'text/csv;charset=utf-8' }), nombreArchivo(base, 'csv'))
}
