import * as XLSX from 'xlsx'
import { nombreArchivo } from './download'

export type CeldaExcel = string | number | null | undefined

export interface HojaExcel {
  /** Nombre de la hoja (máx. 31 caracteres, se trunca automáticamente) */
  nombre: string
  encabezados: string[]
  filas: CeldaExcel[][]
  /** Anchos de columna en caracteres; si se omite se calculan automáticamente */
  anchos?: number[]
}

/** Calcula anchos de columna razonables a partir del contenido. */
function calcularAnchos(encabezados: string[], filas: CeldaExcel[][]): { wch: number }[] {
  return encabezados.map((h, col) => {
    let max = h.length
    for (const fila of filas) {
      const celda = fila[col]
      if (celda == null) continue
      const len = String(celda).length
      if (len > max) max = len
    }
    return { wch: Math.min(Math.max(max + 2, 9), 45) }
  })
}

/**
 * Genera y descarga un archivo .xlsx con una o varias hojas.
 */
export function descargarXlsx(base: string, hojas: HojaExcel[]) {
  const wb = XLSX.utils.book_new()

  for (const hoja of hojas) {
    const datos = [hoja.encabezados, ...hoja.filas.map((f) => f.map((c) => c ?? ''))]
    const ws = XLSX.utils.aoa_to_sheet(datos)
    ws['!cols'] = hoja.anchos
      ? hoja.anchos.map((w) => ({ wch: w }))
      : calcularAnchos(hoja.encabezados, hoja.filas)
    XLSX.utils.book_append_sheet(wb, ws, hoja.nombre.slice(0, 31))
  }

  XLSX.writeFile(wb, nombreArchivo(base, 'xlsx'))
}
