// Lógica de exportación del Histórico (recorridos y cargas de gasolina).
// La vista muestra máximo 50 registros; aquí se consulta TODO lo que
// coincida con los filtros (paginado en lotes de 1000 por el límite de PostgREST).

import { startOfWeek, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { calcKmRecorridos, calcImporte, calcLitrosConsumidos, calcRendimiento } from '@/lib/calculations'
import { formatFecha, formatMoneda, formatDecimal } from '@/utils/formatters'
import { combustibleLabel } from '@/lib/constants'
import { descargarCsv, type CeldaCsv } from '@/utils/export/csv'
import { descargarXlsx, type HojaExcel, type CeldaExcel } from '@/utils/export/xlsx'
import { ReportePdf, type FiltroAplicado } from '@/utils/export/pdf'
import { periodoLabel, type CargaGasolina, type Periodo, type RecorridoHistorico } from './types'

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
export function aplicarFiltrosRecorridos(query: any, filtroVehiculo: string, filtroPeriodo: Periodo) {
  if (filtroVehiculo) {
    query = query.eq('vehiculo_codigo', filtroVehiculo)
  }
  const now = new Date()
  if (filtroPeriodo === 'semana') {
    query = query.gte('fecha_salida', startOfWeek(now, { weekStartsOn: 1 }).toISOString())
  } else if (filtroPeriodo === 'mes') {
    query = query.gte('fecha_salida', startOfMonth(now).toISOString())
  } else if (filtroPeriodo === 'mes_anterior') {
    const prev = subMonths(now, 1)
    query = query
      .gte('fecha_salida', startOfMonth(prev).toISOString())
      .lte('fecha_salida', endOfMonth(prev).toISOString())
  }
  return query
}

/** Cuenta los recorridos que coinciden con los filtros (para el guardrail de descargas grandes). */
export async function contarRecorridos(filtroVehiculo: string, filtroPeriodo: Periodo): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase.from('recorridos') as any).select('id', { count: 'exact', head: true })
  query = aplicarFiltrosRecorridos(query, filtroVehiculo, filtroPeriodo)
  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Trae TODOS los recorridos filtrados, paginando en lotes de 1000. */
export async function fetchRecorridosCompletos(
  filtroVehiculo: string,
  filtroPeriodo: Periodo
): Promise<RecorridoHistorico[]> {
  const todos: RecorridoHistorico[] = []

  for (let desde = 0; ; desde += TAMANO_LOTE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from('recorridos') as any)
      .select(`
        id, vehiculo_codigo, estado, usa_paradas, fecha_salida, fecha_regreso,
        km_salida, km_regreso, combustible_salida, combustible_regreso,
        litros_cargados, precio_litro, foto_salida_path, foto_regreso_path,
        conductores(nombre),
        centros_costo(nombre),
        vehiculos(capacidad_tanque_litros, placa),
        recorridos_paradas(id, orden, estado, fecha_parada, km_parada, combustible_parada, litros_cargados, precio_litro, foto_parada_path, centros_costo(nombre))
      `)
      .order('fecha_salida', { ascending: false })
      .range(desde, desde + TAMANO_LOTE - 1)

    query = aplicarFiltrosRecorridos(query, filtroVehiculo, filtroPeriodo)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const lote = (data ?? []) as RecorridoHistorico[]
    todos.push(...lote)
    if (lote.length < TAMANO_LOTE) break
  }

  return todos
}

// ─────────────────────────────────────────────────────────────────────────────
// Campos calculados por recorrido (mismas fórmulas que la vista)
// ─────────────────────────────────────────────────────────────────────────────

interface RecorridoCalculado {
  r: RecorridoHistorico
  kmRec: number | null
  litrosConsumidos: number | null
  costo: number | null
  rendimiento: number | null
  litrosParadas: number
  costoParadas: number
}

function calcularRecorrido(r: RecorridoHistorico): RecorridoCalculado {
  const kmRec = r.km_regreso != null ? calcKmRecorridos(r.km_salida, r.km_regreso) : null
  const costo =
    r.litros_cargados && r.precio_litro ? calcImporte(r.litros_cargados, r.precio_litro) : null
  const litrosParadas = r.recorridos_paradas.reduce((acc, p) => acc + (p.litros_cargados ?? 0), 0)
  const costoParadas = r.recorridos_paradas.reduce(
    (acc, p) => acc + (p.litros_cargados && p.precio_litro ? calcImporte(p.litros_cargados, p.precio_litro) : 0),
    0
  )
  const litrosConsumidos =
    kmRec != null && r.combustible_regreso != null && r.vehiculos?.capacidad_tanque_litros
      ? calcLitrosConsumidos(
          r.vehiculos.capacidad_tanque_litros,
          r.combustible_salida,
          r.combustible_regreso,
          (r.litros_cargados ?? 0) + litrosParadas
        )
      : null
  const rendimiento =
    kmRec != null && litrosConsumidos != null && litrosConsumidos > 0
      ? calcRendimiento(kmRec, litrosConsumidos)
      : null
  return { r, kmRec, litrosConsumidos, costo, rendimiento, litrosParadas, costoParadas }
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
  'Litros cargados', 'Litros consumidos', 'Precio por litro', 'Costo total',
  'Rendimiento (km/L)', 'Paradas', 'Litros cargados en paradas', 'Costo cargas en paradas',
]

function filasRecorridos(registros: RecorridoHistorico[]): CeldaCsv[][] {
  return registros.map((r) => {
    const c = calcularRecorrido(r)
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
      r.litros_cargados != null ? redondear(r.litros_cargados, 3) : '',
      c.litrosConsumidos != null && c.litrosConsumidos > 0 ? redondear(c.litrosConsumidos, 3) : '',
      r.precio_litro != null ? redondear(r.precio_litro, 3) : '',
      c.costo != null ? redondear(c.costo) : '',
      c.rendimiento != null ? redondear(c.rendimiento) : '',
      r.recorridos_paradas.length || '',
      c.litrosParadas > 0 ? redondear(c.litrosParadas, 3) : '',
      c.costoParadas > 0 ? redondear(c.costoParadas) : '',
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

function totalesRecorridos(registros: RecorridoHistorico[]): TotalesRecorridos {
  const calculados = registros.map(calcularRecorrido)
  const cerrados = calculados.filter((c) => c.r.estado === 'cerrado')
  const km = cerrados.reduce((acc, c) => acc + (c.kmRec ?? 0), 0)
  const litrosCargados = cerrados.reduce(
    (acc, c) => acc + (c.r.litros_cargados ?? 0) + c.litrosParadas,
    0
  )
  const litrosConsumidos = cerrados.reduce(
    (acc, c) => acc + (c.litrosConsumidos != null && c.litrosConsumidos > 0 ? c.litrosConsumidos : 0),
    0
  )
  const costo = cerrados.reduce((acc, c) => acc + (c.costo ?? 0) + c.costoParadas, 0)
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

/** Deriva las cargas de gasolina (regreso final + paradas) de los recorridos. */
function cargasDesdeRecorridos(registros: RecorridoHistorico[]): CeldaCsv[][] {
  const filas: CeldaCsv[][] = []
  for (const r of registros) {
    if (r.litros_cargados && r.precio_litro && r.fecha_regreso && r.km_regreso != null) {
      filas.push([
        r.conductores?.nombre ?? '',
        r.vehiculo_codigo,
        r.vehiculos?.placa ?? '',
        'Regreso final',
        formatFecha(r.fecha_regreso),
        r.km_regreso,
        redondear(r.litros_cargados, 3),
        redondear(r.precio_litro, 3),
        redondear(calcImporte(r.litros_cargados, r.precio_litro)),
      ])
    }
    for (const p of r.recorridos_paradas) {
      if (p.litros_cargados && p.precio_litro && p.fecha_parada && p.km_parada != null) {
        filas.push([
          r.conductores?.nombre ?? '',
          r.vehiculo_codigo,
          r.vehiculos?.placa ?? '',
          'Parada intermedia',
          formatFecha(p.fecha_parada),
          p.km_parada,
          redondear(p.litros_cargados, 3),
          redondear(p.precio_litro, 3),
          redondear(calcImporte(p.litros_cargados, p.precio_litro)),
        ])
      }
    }
  }
  return filas
}

const ENCABEZADOS_CARGAS_DERIVADAS = [
  'Conductor', 'Vehículo', 'Placa', 'Tipo de carga', 'Fecha carga',
  'KM carga', 'Litros cargados', 'Precio por litro', 'Costo total',
]

function filtrosRecorridos(filtroVehiculo: string, filtroPeriodo: Periodo): FiltroAplicado[] {
  return [
    { etiqueta: 'Vehículo', valor: filtroVehiculo || 'Todos' },
    { etiqueta: 'Período', valor: periodoLabel(filtroPeriodo) },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Exportadores: Recorridos
// ─────────────────────────────────────────────────────────────────────────────

export function exportarRecorridosCsv(registros: RecorridoHistorico[]) {
  descargarCsv('historico_recorridos', ENCABEZADOS_RECORRIDOS, filasRecorridos(registros))
}

export function exportarRecorridosXlsx(registros: RecorridoHistorico[]) {
  const t = totalesRecorridos(registros)
  const hojas: HojaExcel[] = [
    {
      nombre: 'Recorridos',
      encabezados: ENCABEZADOS_RECORRIDOS,
      filas: filasRecorridos(registros) as CeldaExcel[][],
    },
    {
      nombre: 'Cargas gasolina',
      encabezados: ENCABEZADOS_CARGAS_DERIVADAS,
      filas: cargasDesdeRecorridos(registros) as CeldaExcel[][],
    },
    {
      nombre: 'Resumen',
      encabezados: ['Indicador', 'Valor'],
      filas: [
        ['Recorridos totales', t.total],
        ['Recorridos cerrados', t.cerrados],
        ['KM recorridos', t.km],
        ['Litros cargados (incluye paradas)', redondear(t.litrosCargados, 3)],
        ['Litros consumidos', redondear(t.litrosConsumidos, 3)],
        ['Costo total combustible', redondear(t.costo)],
        ['Rendimiento promedio (km/L)', t.rendimientoPromedio != null ? redondear(t.rendimientoPromedio) : '—'],
      ],
      anchos: [34, 16],
    },
  ]
  descargarXlsx('historico_recorridos', hojas)
}

export function exportarRecorridosPdf(
  registros: RecorridoHistorico[],
  filtroVehiculo: string,
  filtroPeriodo: Periodo
) {
  const t = totalesRecorridos(registros)
  const reporte = new ReportePdf('Reporte de recorridos', 'landscape')

  reporte.agregarFiltros(filtrosRecorridos(filtroVehiculo, filtroPeriodo))
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
      const c = calcularRecorrido(r)
      return [
        r.vehiculo_codigo,
        r.vehiculos?.placa ?? '—',
        r.conductores?.nombre ?? '—',
        r.centros_costo?.nombre ?? '—',
        formatFecha(r.fecha_salida),
        r.fecha_regreso ? formatFecha(r.fecha_regreso) : '—',
        c.kmRec != null ? c.kmRec.toLocaleString() : '—',
        r.litros_cargados != null ? formatDecimal(r.litros_cargados) : '—',
        c.litrosConsumidos != null && c.litrosConsumidos > 0 ? formatDecimal(c.litrosConsumidos) : '—',
        c.costo != null ? formatMoneda(c.costo) : '—',
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
    'Las fotos de tablero están disponibles en la aplicación.'
  )
  reporte.guardar('historico_recorridos')
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapeo a filas exportables: Cargas de gasolina
// ─────────────────────────────────────────────────────────────────────────────

const ENCABEZADOS_CARGAS = [
  'Conductor', 'Vehículo', 'Placa', 'Modelo', 'Tipo de carga', 'Fecha carga',
  'KM carga', 'Litros cargados', 'Precio por litro', 'Costo total',
  'Fecha siguiente carga', 'KM siguiente carga',
]

function filasCargas(cargas: CargaGasolina[]): CeldaCsv[][] {
  return cargas.map((c) => [
    c.conductor,
    c.vehiculo_codigo,
    c.placa ?? '',
    c.modelo ?? '',
    c.tipo_carga === 'regreso_final' ? 'Regreso final' : 'Parada intermedia',
    formatFecha(c.fecha_carga),
    c.km_carga,
    redondear(c.litros_cargados, 3),
    redondear(c.precio_litro, 3),
    redondear(c.costo_total),
    c.fecha_siguiente_carga ? formatFecha(c.fecha_siguiente_carga) : '',
    c.km_siguiente_carga ?? '',
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
    ['Conductor', 'Vehículo', 'Placa', 'Tipo', 'Fecha carga', 'KM carga', 'Litros', '$/L', 'Costo total'],
    cargas.map((c) => [
      c.conductor,
      c.vehiculo_codigo,
      c.placa ?? '—',
      c.tipo_carga === 'regreso_final' ? 'Regreso final' : 'Parada intermedia',
      formatFecha(c.fecha_carga),
      c.km_carga.toLocaleString(),
      formatDecimal(c.litros_cargados),
      `$${c.precio_litro.toFixed(3)}`,
      formatMoneda(c.costo_total),
    ]),
    {
      columnasDerecha: [5, 6, 7, 8],
      filaTotales: [
        'Totales', '', '', '', '', '',
        formatDecimal(totalLitros),
        totalLitros > 0 ? `$${(totalCosto / totalLitros).toFixed(3)} prom.` : '—',
        formatMoneda(totalCosto),
      ],
    }
  )

  reporte.guardar('cargas_gasolina')
}
