// Exportación detallada de Refacciones / Otros gastos: una fila por
// registro filtrado (mismo criterio que la vista: vehículo + búsqueda),
// con referencia al mantenimiento ligado cuando existe.

import type { Refaccion, Vehiculo, Mantenimiento } from '@/lib/supabase'
import { formatFecha } from '@/utils/formatters'
import { mantenimientoTipoLabel, REFACCION_CATEGORIAS, type RefaccionCategoria } from '@/lib/constants'
import { getPublicUrlMantenimiento } from '@/utils/storage'
import { descargarXlsx, type HojaExcel, type CeldaExcel } from '@/utils/export/xlsx'

function redondear(valor: number, decimales = 2): number {
  const f = 10 ** decimales
  return Math.round(valor * f) / f
}

export interface FiltrosRefaccionesGastos {
  vehiculo: string
  busqueda: string
}

const ENCABEZADOS = [
  'Vehículo', 'Apodo', 'Nombre', 'Motivo', 'Costo', 'Proveedor',
  'Fecha de compra', 'KM al momento', 'Ligado a mantenimiento', 'Observaciones', 'Factura',
]

export function exportarRefaccionesGastosXlsx(
  categoria: RefaccionCategoria,
  filtradas: Refaccion[],
  vehiculos: Vehiculo[],
  mantenimientos: Mantenimiento[],
  filtros: FiltrosRefaccionesGastos
) {
  const ui = REFACCION_CATEGORIAS[categoria]
  const apodoPorCodigo = Object.fromEntries(vehiculos.map((v) => [v.codigo, v.apodo]))
  const mantenimientoPorId = new Map(mantenimientos.map((m) => [m.id, m]))

  const filas: CeldaExcel[][] = filtradas.map((r) => {
    const ligado = r.mantenimiento_id ? mantenimientoPorId.get(r.mantenimiento_id) : null
    return [
      r.vehiculo_codigo,
      apodoPorCodigo[r.vehiculo_codigo] ?? '',
      r.nombre,
      r.motivo,
      redondear(r.costo),
      r.proveedor ?? '',
      r.fecha_compra?.slice(0, 10) ?? '',
      r.km_al_momento ?? '',
      ligado ? `${formatFecha(ligado.fecha_ingreso)} · ${mantenimientoTipoLabel(ligado.tipo)}` : 'No',
      r.observaciones ?? '',
      r.factura_path ? getPublicUrlMantenimiento(r.factura_path) : '',
    ]
  })

  const total = filtradas.reduce((s, r) => s + r.costo, 0)

  const hojas: HojaExcel[] = [
    { nombre: ui.labelPlural.slice(0, 31), encabezados: ENCABEZADOS, filas },
    {
      nombre: 'Resumen',
      encabezados: ['Indicador', 'Valor'],
      filas: [
        ['Vehículo (filtro)', filtros.vehiculo || 'Todos'],
        ['Búsqueda (filtro)', filtros.busqueda || '—'],
        ['Registros', filtradas.length],
        ['Costo total', redondear(total)],
      ],
      anchos: [22, 20],
    },
  ]

  descargarXlsx(categoria === 'refaccion' ? 'refacciones' : 'otros_gastos', hojas)
}
