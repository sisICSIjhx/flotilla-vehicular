// Exportación detallada del Historial de mantenimientos: una fila por
// servicio de taller (con las refacciones ligadas resumidas), más una
// hoja aparte con el detalle de esas refacciones y un resumen con los
// filtros aplicados. Respeta exactamente lo que la vista tiene filtrado.

import type { Mantenimiento, Refaccion, Vehiculo } from '@/lib/supabase'
import { formatFecha } from '@/utils/formatters'
import { mantenimientoTipoLabel, MANTENIMIENTO_ESTADOS } from '@/lib/constants'
import { getPublicUrlMantenimiento } from '@/utils/storage'
import { descargarXlsx, type HojaExcel, type CeldaExcel } from '@/utils/export/xlsx'
import { diasEnTaller } from '../shared'

function redondear(valor: number, decimales = 2): number {
  const f = 10 ** decimales
  return Math.round(valor * f) / f
}

export interface FiltrosHistorial {
  vehiculo: string
  tipo: string
  desde: string
  hasta: string
}

const ENCABEZADOS_MANTENIMIENTOS = [
  'Vehículo', 'Placa', 'Apodo', 'Tipo', 'Estado', 'Descripción', 'Lugar / taller',
  'KM al ingreso', 'Fecha de ingreso', 'Fecha de salida', 'Días en taller',
  'Costo servicio', 'Refacciones ligadas', 'Costo refacciones', 'Costo total',
  'Ingreso excepcional', 'Autorizado por', 'Motivo excepción', 'Observaciones', 'Factura',
]

function filasMantenimientos(
  mantenimientos: Mantenimiento[],
  refacciones: Refaccion[],
  vehiculosInfo: Record<string, { placa: string | null; apodo: string | null }>
): CeldaExcel[][] {
  return mantenimientos.map((m) => {
    const refs = refacciones.filter((r) => r.mantenimiento_id === m.id)
    const costoRefs = refs.reduce((s, r) => s + r.costo, 0)
    const info = vehiculosInfo[m.vehiculo_codigo]
    return [
      m.vehiculo_codigo,
      info?.placa ?? '',
      info?.apodo ?? '',
      mantenimientoTipoLabel(m.tipo),
      MANTENIMIENTO_ESTADOS[m.estado]?.label ?? m.estado,
      m.descripcion,
      m.lugar ?? '',
      m.km_al_ingreso ?? '',
      formatFecha(m.fecha_ingreso),
      m.fecha_salida ? formatFecha(m.fecha_salida) : '',
      diasEnTaller(m) ?? '',
      m.costo != null ? redondear(m.costo) : '',
      refs.length || '',
      costoRefs > 0 ? redondear(costoRefs) : '',
      redondear((m.costo ?? 0) + costoRefs),
      m.ingreso_excepcional ? 'Sí' : 'No',
      m.autorizado_por ?? '',
      m.motivo_excepcion ?? '',
      m.observaciones ?? '',
      m.factura_path ? getPublicUrlMantenimiento(m.factura_path) : '',
    ]
  })
}

const ENCABEZADOS_REFACCIONES = [
  'Vehículo', 'Fecha ingreso mantenimiento', 'Tipo mantenimiento', 'Nombre', 'Motivo',
  'Costo', 'Proveedor', 'Fecha de compra', 'KM al momento', 'Observaciones', 'Factura',
]

function filasRefaccionesLigadas(mantenimientos: Mantenimiento[], refacciones: Refaccion[]): CeldaExcel[][] {
  const porId = new Map(mantenimientos.map((m) => [m.id, m]))
  return refacciones
    .filter((r) => r.mantenimiento_id && porId.has(r.mantenimiento_id))
    .map((r) => {
      const m = porId.get(r.mantenimiento_id as string)!
      return [
        r.vehiculo_codigo,
        formatFecha(m.fecha_ingreso),
        mantenimientoTipoLabel(m.tipo),
        r.nombre,
        r.motivo,
        redondear(r.costo),
        r.proveedor ?? '',
        r.fecha_compra?.slice(0, 10) ?? '',
        r.km_al_momento ?? '',
        r.observaciones ?? '',
        r.factura_path ? getPublicUrlMantenimiento(r.factura_path) : '',
      ]
    })
}

export function exportarHistorialXlsx(
  mantenimientos: Mantenimiento[],
  refacciones: Refaccion[],
  vehiculos: Vehiculo[],
  filtros: FiltrosHistorial
) {
  const vehiculosInfo = Object.fromEntries(
    vehiculos.map((v) => [v.codigo, { placa: v.placa, apodo: v.apodo }])
  )

  const totalCosto = mantenimientos.reduce((s, m) => s + (m.costo ?? 0), 0)
  const totalRefs = mantenimientos.reduce(
    (s, m) => s + refacciones.filter((r) => r.mantenimiento_id === m.id).reduce((x, r) => x + r.costo, 0),
    0
  )
  const cerrados = mantenimientos.filter((m) => m.fecha_salida)
  const promedioDias: CeldaExcel =
    cerrados.length > 0
      ? redondear(cerrados.reduce((s, m) => s + (diasEnTaller(m) ?? 0), 0) / cerrados.length, 1)
      : '—'

  const hojas: HojaExcel[] = [
    {
      nombre: 'Mantenimientos',
      encabezados: ENCABEZADOS_MANTENIMIENTOS,
      filas: filasMantenimientos(mantenimientos, refacciones, vehiculosInfo),
    },
    {
      nombre: 'Refacciones ligadas',
      encabezados: ENCABEZADOS_REFACCIONES,
      filas: filasRefaccionesLigadas(mantenimientos, refacciones),
    },
    {
      nombre: 'Resumen',
      encabezados: ['Indicador', 'Valor'],
      filas: [
        ['Vehículo (filtro)', filtros.vehiculo || 'Todos'],
        ['Tipo (filtro)', filtros.tipo ? mantenimientoTipoLabel(filtros.tipo) : 'Todos'],
        ['Desde (filtro)', filtros.desde || '—'],
        ['Hasta (filtro)', filtros.hasta || '—'],
        ['Servicios', mantenimientos.length],
        ['Costo de servicios', redondear(totalCosto)],
        ['Costo de refacciones ligadas', redondear(totalRefs)],
        ['Costo total', redondear(totalCosto + totalRefs)],
        ['Días promedio en taller', promedioDias],
      ],
      anchos: [28, 18],
    },
  ]

  descargarXlsx('historial_mantenimientos', hojas)
}
