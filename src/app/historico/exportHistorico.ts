// Lógica de exportación del Histórico (recorridos y cargas de gasolina).
// La vista muestra máximo 50 registros; aquí se consulta TODO lo que
// coincida con los filtros (paginado en lotes de 1000 por el límite de PostgREST).

import { supabase } from '@/lib/supabase'
import { calcKmRecorridos, calcLitrosConsumidos, calcRendimiento } from '@/lib/calculations'
import { formatFecha, formatMoneda, formatDecimal } from '@/utils/formatters'
import { combustibleLabel } from '@/lib/constants'
import { descargarCsv, type CeldaCsv } from '@/utils/export/csv'
import { descargarXlsx, type HojaExcel, type CeldaExcel } from '@/utils/export/xlsx'
import { ReportePdf, type FiltroAplicado } from '@/utils/export/pdf'
import { type CargaGasolina, type FuelMap, type RecorridoHistorico } from './types'

const TAMANO_LOTE = 1000

// ─────────────────────────────────────────────────────────────────────────────
// Consulta completa (sin límite de 50)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aplica los filtros de vehículo y período a una query de recorridos.
 * Compartida entre la vista (tabla de 50) y la exportación (todos los registros)
 * para garantizar que la descarga coincida con lo filtrado en pantalla.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function aplicarFiltrosRecorridos(query: any, filtroVehiculo: string, fechaInicio: string, fechaFin: string) {
  if (filtroVehiculo) {
    query = query.eq('vehiculo_codigo', filtroVehiculo)
  }
  query = query
    .gte('fecha_salida', new Date(fechaInicio + 'T00:00:00').toISOString())
    .lte('fecha_salida', new Date(fechaFin + 'T23:59:59').toISOString())
  return query
}

/** Cuenta los recorridos que coinciden con los filtros (para el guardrail de descargas grandes). */
export async function contarRecorridos(filtroVehiculo: string, fechaInicio: string, fechaFin: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase.from('recorridos') as any).select('id', { count: 'exact', head: true })
  query = aplicarFiltrosRecorridos(query, filtroVehiculo, fechaInicio, fechaFin)
  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Trae TODOS los recorridos filtrados, paginando en lotes de 1000, más el FuelMap de cargas_gasolina. */
export async function fetchRecorridosCompletos(
  filtroVehiculo: string,
  fechaInicio: string,
  fechaFin: string
): Promise<{ registros: RecorridoHistorico[]; fuelMap: FuelMap }> {
  const todos: RecorridoHistorico[] = []

  for (let desde = 0; ; desde += TAMANO_LOTE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from('recorridos') as any)
      .select(`
        id, vehiculo_codigo, estado, usa_paradas, fecha_salida, fecha_regreso,
        km_salida, km_regreso, combustible_salida, combustible_regreso,
        foto_salida_path, foto_regreso_path,
        conductores(nombre),
        centros_costo(nombre),
        vehiculos(capacidad_tanque_litros, placa),
        recorridos_paradas(id, orden, estado, fecha_parada, km_parada, combustible_parada, foto_parada_path, centros_costo(nombre))
      `)
      .order('fecha_salida', { ascending: false })
      .range(desde, desde + TAMANO_LOTE - 1)

    query = aplicarFiltrosRecorridos(query, filtroVehiculo, fechaInicio, fechaFin)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const lote = (data ?? []) as RecorridoHistorico[]
    todos.push(...lote)
    if (lote.length < TAMANO_LOTE) break
  }

  // Batch fetch fuel sums via RPC (incluye cargas con recorrido_id directo
  // y cargas sin recorrido_id asociadas por rango km+fecha)
  const fuelMap: FuelMap = new Map()
  if (todos.length > 0) {
    try {
      const ids = todos.map((r) => r.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: cargasData } = await (supabase as any)
        .rpc('get_fuel_por_recorridos', { p_recorrido_ids: ids })
      for (const c of (cargasData ?? [])) {
        fuelMap.set(c.recorrido_id, {
          litros: Number(c.litros),
          costo: Number(c.costo),
        })
      }
    } catch {
      // RPC no disponible — fuelMap stays empty
    }
  }

  return { registros: todos, fuelMap }
}

// ─────────────────────────────────────────────────────────────────────────────
// Campos calculados por recorrido (mismas fórmulas que la vista)
// ─────────────────────────────────────────────────────────────────────────────

interface RecorridoCalculado {
  r: RecorridoHistorico
  kmRec: number | null
  totalLitros: number
  totalCosto: number
  litrosConsumidos: number | null
  rendimiento: number | null
}

function calcularRecorrido(r: RecorridoHistorico, fuelMap: FuelMap): RecorridoCalculado {
  const kmRec = r.km_regreso != null ? calcKmRecorridos(r.km_salida, r.km_regreso) : null
  const fuelData = fuelMap.get(r.id)
  const totalLitros = fuelData?.litros ?? 0
  const totalCosto = fuelData?.costo ?? 0
  const litrosConsumidos =
    kmRec != null && r.combustible_regreso != null && r.vehiculos?.capacidad_tanque_litros
      ? calcLitrosConsumidos(
          r.vehiculos.capacidad_tanque_litros,
          r.combustible_salida,
          r.combustible_regreso,
          totalLitros
        )
      : null
  const rendimiento =
    kmRec != null && litrosConsumidos != null && litrosConsumidos > 0
      ? calcRendimiento(kmRec, litrosConsumidos)
      : null
  return { r, kmRec, totalLitros, totalCosto, litrosConsumidos, rendimiento }
}

function redondear(valor: number, decimales = 2): number {
  const f = 10 ** decimales
  return Math.round(valor * f) / f
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapeo a filas exportables: Recorridos
// ─────────────────────────────────────────────────────────────────────────────

const ENCABEZADOS_RECORRIDOS = [
  'Vehículo', 'Placa', 'Conductor', 'Centro de costo', 'Estado',
  'Fecha salida', 'Fecha regreso', 'KM salida', 'KM regreso', 'KM recorridos',
  'Combustible salida', 'Combustible regreso',
  'Litros cargados (cargas ext.)', 'Litros consumidos', 'Costo total combustible',
  'Rendimiento (km/L)', 'Paradas',
]

function filasRecorridos(registros: RecorridoHistorico[], fuelMap: FuelMap): CeldaCsv[][] {
  return registros.map((r) => {
    const c = calcularRecorrido(r, fuelMap)
    return [
      r.vehiculo_codigo,
      r.vehiculos?.placa ?? '',
      r.conductores?.nombre ?? '',
      r.centros_costo?.nombre ?? '',
      r.estado === 'cerrado' ? 'Cerrado' : 'En ruta',
      formatFecha(r.fecha_salida),
      r.fecha_regreso ? formatFecha(r.fecha_regreso) : '',
      r.km_salida,
      r.km_regreso ?? '',
      c.kmRec ?? '',
      combustibleLabel(r.combustible_salida),
      r.combustible_regreso != null ? combustibleLabel(r.combustible_regreso) : '',
      c.totalLitros > 0 ? redondear(c.totalLitros, 3) : '',
      c.litrosConsumidos != null && c.litrosConsumidos > 0 ? redondear(c.litrosConsumidos, 3) : '',
      c.totalCosto > 0 ? redondear(c.totalCosto) : '',
      c.rendimiento != null ? redondear(c.rendimiento) : '',
      r.recorridos_paradas.length || '',
    ]
  })
}

interface TotalesRecorridos {
  total: number
  cerrados: number
  km: number
  litrosCargados: number
  litrosConsumidos: number
  costo: number
  rendimientoPromedio: number | null
}

function totalesRecorridos(registros: RecorridoHistorico[], fuelMap: FuelMap): TotalesRecorridos {
  const calculados = registros.map((r) => calcularRecorrido(r, fuelMap))
  const cerrados = calculados.filter((c) => c.r.estado === 'cerrado')
  const km = cerrados.reduce((acc, c) => acc + (c.kmRec ?? 0), 0)
  const litrosCargados = cerrados.reduce((acc, c) => acc + c.totalLitros, 0)
  const litrosConsumidos = cerrados.reduce(
    (acc, c) => acc + (c.litrosConsumidos != null && c.litrosConsumidos > 0 ? c.litrosConsumidos : 0),
    0
  )
  const costo = cerrados.reduce((acc, c) => acc + c.totalCosto, 0)
  return {
    total: registros.length,
    cerrados: cerrados.length,
    km,
    litrosCargados,
    litrosConsumidos,
    costo,
    rendimientoPromedio: calcRendimiento(km, litrosConsumidos),
  }
}

function filtrosRecorridos(filtroVehiculo: string, filtroConductor: string, fechaInicio: string, fechaFin: string): FiltroAplicado[] {
  return [
    { etiqueta: 'Desde', valor: fechaInicio },
    { etiqueta: 'Hasta', valor: fechaFin },
    { etiqueta: 'Vehículo', valor: filtroVehiculo || 'Todos' },
    { etiqueta: 'Conductor', valor: filtroConductor || 'Todos' },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Exportadores: Recorridos
// ─────────────────────────────────────────────────────────────────────────────

export function exportarRecorridosCsv(registros: RecorridoHistorico[], fuelMap: FuelMap) {
  descargarCsv('historico_recorridos', ENCABEZADOS_RECORRIDOS, filasRecorridos(registros, fuelMap))
}

export function exportarRecorridosXlsx(registros: RecorridoHistorico[], fuelMap: FuelMap) {
  const t = totalesRecorridos(registros, fuelMap)
  const hojas: HojaExcel[] = [
    {
      nombre: 'Recorridos',
      encabezados: ENCABEZADOS_RECORRIDOS,
      filas: filasRecorridos(registros, fuelMap) as CeldaExcel[][],
    },
    {
      nombre: 'Resumen',
      encabezados: ['Indicador', 'Valor'],
      filas: [
        ['Recorridos totales', t.total],
        ['Recorridos cerrados', t.cerrados],
        ['KM recorridos', t.km],
        ['Litros cargados (cargas externas)', redondear(t.litrosCargados, 3)],
        ['Litros consumidos', redondear(t.litrosConsumidos, 3)],
        ['Costo total combustible', redondear(t.costo)],
        ['Rendimiento promedio (km/L)', t.rendimientoPromedio != null ? redondear(t.rendimientoPromedio) : '—'],
      ],
      anchos: [36, 16],
    },
  ]
  descargarXlsx('historico_recorridos', hojas)
}

export function exportarRecorridosPdf(
  registros: RecorridoHistorico[],
  fuelMap: FuelMap,
  filtroVehiculo: string,
  filtroConductor: string,
  fechaInicio: string,
  fechaFin: string
) {
  const t = totalesRecorridos(registros, fuelMap)
  const reporte = new ReportePdf('Reporte de recorridos', 'landscape')

  reporte.agregarFiltros(filtrosRecorridos(filtroVehiculo, filtroConductor, fechaInicio, fechaFin))
  reporte.agregarTarjetas([
    { etiqueta: 'Recorridos', valor: String(t.total) },
    { etiqueta: 'KM totales', valor: t.km.toLocaleString() },
    { etiqueta: 'Litros cargados', valor: `${formatDecimal(t.litrosCargados)} L` },
    { etiqueta: 'Costo total', valor: formatMoneda(t.costo) },
    {
      etiqueta: 'Rendimiento promedio',
      valor: t.rendimientoPromedio != null ? `${formatDecimal(t.rendimientoPromedio, 2)} km/L` : '—',
    },
  ])

  reporte.agregarSeccion('Detalle de recorridos')
  reporte.agregarTabla(
    ['Vehículo', 'Placa', 'Conductor', 'Centro de costo', 'Salida', 'Regreso',
      'KM rec.', 'L. carg.', 'L. cons.', 'Costo', 'Rend.', 'Estado'],
    registros.map((r) => {
      const c = calcularRecorrido(r, fuelMap)
      return [
        r.vehiculo_codigo,
        r.vehiculos?.placa ?? '—',
        r.conductores?.nombre ?? '—',
        r.centros_costo?.nombre ?? '—',
        formatFecha(r.fecha_salida),
        r.fecha_regreso ? formatFecha(r.fecha_regreso) : '—',
        c.kmRec != null ? c.kmRec.toLocaleString() : '—',
        c.totalLitros > 0 ? formatDecimal(c.totalLitros) : '—',
        c.litrosConsumidos != null && c.litrosConsumidos > 0 ? formatDecimal(c.litrosConsumidos) : '—',
        c.totalCosto > 0 ? formatMoneda(c.totalCosto) : '—',
        c.rendimiento != null ? `${formatDecimal(c.rendimiento, 2)}` : '—',
        r.estado === 'cerrado' ? 'Cerrado' : 'En ruta',
      ]
    }),
    {
      columnasDerecha: [6, 7, 8, 9, 10],
      filaTotales: [
        'Totales', '', '', '', '', '',
        t.km.toLocaleString(),
        formatDecimal(t.litrosCargados),
        formatDecimal(t.litrosConsumidos),
        formatMoneda(t.costo),
        t.rendimientoPromedio != null ? formatDecimal(t.rendimientoPromedio, 2) : '—',
        '',
      ],
    }
  )

  reporte.agregarNota(
    'L. cons. = balance real del tanque (nivel inicial + recargas − nivel final). ' +
    'Rendimiento en km/L. Los totales consideran solo recorridos cerrados. ' +
    'L. carg. = litros registrados en módulo Cargas de Gasolina para este recorrido.'
  )
  reporte.guardar('historico_recorridos')
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapeo a filas exportables: Cargas de gasolina
// ─────────────────────────────────────────────────────────────────────────────

const ENCABEZADOS_CARGAS = [
  'Fecha', 'Vehículo', 'Placa', 'Conductor',
  'KM',
  'Nivel antes', 'Nivel después',
  'Litros cargados', 'Precio por litro', 'Costo total',
  'Tipo', 'Destino/Recorrido', 'Observaciones',
]

function filasCargas(cargas: CargaGasolina[]): CeldaCsv[][] {
  return cargas.map((c) => [
    formatFecha(c.fecha_carga),
    c.vehiculo_codigo,
    c.placa ?? '',
    c.conductor,
    c.km_antes,
    combustibleLabel(c.combustible_antes),
    combustibleLabel(c.combustible_despues),
    redondear(c.litros_cargados, 3),
    redondear(c.precio_litro, 3),
    redondear(c.costo_total),
    c.recorrido_id ? 'En recorrido' : 'Fuera de recorrido',
    c.destino ?? '',
    c.observaciones ?? '',
  ])
}

interface FiltrosCargas {
  fechaInicio: string
  fechaFin: string
  vehiculo: string
  conductor: string
  tipo: string
}

function filtrosCargasPdf(f: FiltrosCargas): FiltroAplicado[] {
  return [
    { etiqueta: 'Desde', valor: f.fechaInicio },
    { etiqueta: 'Hasta', valor: f.fechaFin },
    { etiqueta: 'Vehículo', valor: f.vehiculo || 'Todos' },
    { etiqueta: 'Conductor', valor: f.conductor || 'Todos' },
    { etiqueta: 'Tipo', valor: f.tipo },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Exportadores: Cargas de gasolina
// ─────────────────────────────────────────────────────────────────────────────

export function exportarCargasCsv(cargas: CargaGasolina[]) {
  descargarCsv('cargas_gasolina', ENCABEZADOS_CARGAS, filasCargas(cargas))
}

export function exportarCargasXlsx(cargas: CargaGasolina[]) {
  const totalLitros = cargas.reduce((acc, c) => acc + c.litros_cargados, 0)
  const totalCosto = cargas.reduce((acc, c) => acc + c.costo_total, 0)
  const hojas: HojaExcel[] = [
    {
      nombre: 'Cargas gasolina',
      encabezados: ENCABEZADOS_CARGAS,
      filas: filasCargas(cargas) as CeldaExcel[][],
    },
    {
      nombre: 'Resumen',
      encabezados: ['Indicador', 'Valor'],
      filas: [
        ['Total de cargas', cargas.length],
        ['Total litros', redondear(totalLitros, 3)],
        ['Precio promedio por litro', totalLitros > 0 ? redondear(totalCosto / totalLitros, 3) : '—'],
        ['Total gastado', redondear(totalCosto)],
      ],
      anchos: [28, 16],
    },
  ]
  descargarXlsx('cargas_gasolina', hojas)
}

export function exportarCargasPdf(cargas: CargaGasolina[], filtros: FiltrosCargas) {
  const totalLitros = cargas.reduce((acc, c) => acc + c.litros_cargados, 0)
  const totalCosto = cargas.reduce((acc, c) => acc + c.costo_total, 0)

  const reporte = new ReportePdf('Reporte de cargas de gasolina', 'landscape')
  reporte.agregarFiltros(filtrosCargasPdf(filtros))
  reporte.agregarTarjetas([
    { etiqueta: 'Total cargas', valor: String(cargas.length) },
    { etiqueta: 'Total litros', valor: `${formatDecimal(totalLitros)} L` },
    {
      etiqueta: 'Precio promedio/L',
      valor: totalLitros > 0 ? `$${(totalCosto / totalLitros).toFixed(3)}` : '—',
    },
    { etiqueta: 'Total gastado', valor: formatMoneda(totalCosto) },
  ])

  reporte.agregarSeccion('Detalle de cargas')
  reporte.agregarTabla(
    ['Fecha', 'Vehículo', 'Conductor', 'KM', 'Litros', '$/L', 'Costo total', 'Tipo'],
    cargas.map((c) => [
      formatFecha(c.fecha_carga),
      c.vehiculo_codigo,
      c.conductor,
      c.km_antes.toLocaleString(),
      formatDecimal(c.litros_cargados),
      `$${c.precio_litro.toFixed(3)}`,
      formatMoneda(c.costo_total),
      c.recorrido_id ? 'En recorrido' : 'Fuera de recorrido',
    ]),
    {
      columnasDerecha: [3, 4, 5, 6, 7],
      filaTotales: [
        'Totales', '', '',
        '', '',
        formatDecimal(totalLitros),
        totalLitros > 0 ? `$${(totalCosto / totalLitros).toFixed(3)} prom.` : '—',
        formatMoneda(totalCosto),
        '',
      ],
    }
  )

  reporte.guardar('cargas_gasolina')
}
