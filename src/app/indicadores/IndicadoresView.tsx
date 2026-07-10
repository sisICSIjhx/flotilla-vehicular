'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Chart } from 'react-chartjs-2'
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  subWeeks,
  subMonths,
  addDays,
  getDate,
  format,
  parseISO,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import { calcKmRecorridos, calcLitrosConsumidos, calcRendimiento } from '@/lib/calculations'
import { formatMoneda, formatDecimal } from '@/utils/formatters'
import Loading from '@/components/common/Loading'
import ErrorMessage from '@/components/common/ErrorMessage'
import ExportButtons from '@/components/common/ExportButtons'
import {
  buildDatasets,
  buildDatasetsStacked,
  buildDatasetsStackedConTendencia,
  stackedTotalPlugin,
  chartOptions,
  chartOptionsConLeyenda,
  chartOptionsStacked,
  type TipoFiltro,
  type TipoGrafica,
} from './chartConfig'
import {
  exportarIndicadoresCsv,
  exportarIndicadoresXlsx,
  exportarIndicadoresPdf,
  type DatosIndicadores,
  type ResumenVehiculo,
} from './exportIndicadores'

interface RecorridoCerrado {
  id: string
  vehiculo_codigo: string
  fecha_salida: string
  km_salida: number
  km_regreso: number
  combustible_salida: number
  combustible_regreso: number
  vehiculos: { capacidad_tanque_litros: number; apodo: string | null } | null
}

type FuelMap = Map<string, { litros: number; costo: number }>

function recTotalLitros(id: string, fuelMap: FuelMap): number {
  return fuelMap.get(id)?.litros ?? 0
}

function recTotalCosto(id: string, fuelMap: FuelMap): number {
  return fuelMap.get(id)?.costo ?? 0
}

interface StatCard {
  label: string
  valor: string
  emoji: string
}

function hoy() {
  return format(new Date(), 'yyyy-MM-dd')
}
function inicioSemanaActual() {
  return format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
}
function mesAnioActual() {
  return format(new Date(), 'yyyy-MM')
}

export default function IndicadoresView() {
  const router = useRouter()
  const [datos, setDatos] = useState<RecorridoCerrado[]>([])
  const [vehiculos, setVehiculos] = useState<{ codigo: string; apodo: string | null; placa: string | null }[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cargasFuelData, setCargasFuelData] = useState<FuelMap>(new Map())

  // Filtro de período
  const [tipo, setTipo] = useState<TipoFiltro>('mes')
  const [fechaDia, setFechaDia] = useState(hoy())
  const [semanaRef, setSemanaRef] = useState(inicioSemanaActual())
  const [mesAnio, setMesAnio] = useState(mesAnioActual())
  const [rangoDesde, setRangoDesde] = useState(() => format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [rangoHasta, setRangoHasta] = useState(hoy())

  // Filtro por vehículo
  const [vehiculoFiltro, setVehiculoFiltro] = useState('')

  // Tipo de gráfica
  const [tipoGrafica, setTipoGrafica] = useState<TipoGrafica>('barras')

  useEffect(() => { cargarVehiculos() }, [])

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, fechaDia, semanaRef, mesAnio, rangoDesde, rangoHasta])

  async function cargarVehiculos() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('vehiculos') as any)
      .select('codigo, apodo, placa')
      .eq('estado', 'activo')
      .order('codigo', { ascending: true })
    if (data) setVehiculos(data as { codigo: string; apodo: string | null; placa: string | null }[])
  }

  function calcularRango(): { desde: string; hasta: string } {
    switch (tipo) {
      case 'dia': {
        const d = parseISO(fechaDia)
        return { desde: startOfDay(subDays(d, 1)).toISOString(), hasta: endOfDay(addDays(d, 1)).toISOString() }
      }
      case 'semana': {
        const lunes = parseISO(semanaRef)
        return {
          desde: startOfDay(lunes).toISOString(),
          hasta: endOfDay(endOfWeek(lunes, { weekStartsOn: 1 })).toISOString(),
        }
      }
      case 'mes': {
        const d = parseISO(`${mesAnio}-01`)
        return { desde: startOfMonth(d).toISOString(), hasta: endOfMonth(d).toISOString() }
      }
      case 'rango':
        return {
          desde: startOfDay(parseISO(rangoDesde)).toISOString(),
          hasta: endOfDay(parseISO(rangoHasta)).toISOString(),
        }
    }
  }

  async function cargar() {
    setCargando(true)
    setError(null)
    try {
      const { desde, hasta } = calcularRango()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: qError } = await (supabase.from('recorridos') as any)
        .select('id, vehiculo_codigo, fecha_salida, km_salida, km_regreso, combustible_salida, combustible_regreso, vehiculos(capacidad_tanque_litros, apodo)')
        .eq('estado', 'cerrado')
        .gte('fecha_salida', desde)
        .lte('fecha_salida', hasta)
        .order('fecha_salida', { ascending: true })
      if (qError) throw new Error(qError.message)
      const rows = (data ?? []) as RecorridoCerrado[]
      setDatos(rows)

      // Batch fetch fuel sums via RPC (incluye cargas con recorrido_id directo
      // y cargas sin recorrido_id asociadas por rango km+fecha)
      if (rows.length > 0) {
        try {
          const ids = rows.map((r) => r.id)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: cargasData } = await (supabase as any)
            .rpc('get_fuel_por_recorridos', { p_recorrido_ids: ids })

          const fuelMap: FuelMap = new Map()
          for (const c of (cargasData ?? [])) {
            fuelMap.set(c.recorrido_id, {
              litros: Number(c.litros),
              costo: Number(c.costo),
            })
          }
          setCargasFuelData(fuelMap)
        } catch {
          setCargasFuelData(new Map())
        }
      } else {
        setCargasFuelData(new Map())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar indicadores')
    } finally {
      setCargando(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Calculando indicadores..." />
      </div>
    )
  }

  // ── Datos filtrados ────────────────────────────────────────────────────────
  const datosFiltrados = vehiculoFiltro
    ? datos.filter((r) => r.vehiculo_codigo === vehiculoFiltro)
    : datos

  // Mapas codigo → apodo / placa para labels de gráficas y tabla
  const apodoMap = Object.fromEntries(vehiculos.map((v) => [v.codigo, v.apodo]))
  const placaMap = Object.fromEntries(vehiculos.map((v) => [v.codigo, v.placa]))
  const labelVehiculo = (codigo: string) => {
    const placa = placaMap[codigo] ?? null
    const apodo = apodoMap[codigo] ?? datos.find((r) => r.vehiculo_codigo === codigo)?.vehiculos?.apodo
    return [placa, apodo].filter(Boolean).join(' — ') || codigo
  }

  // ── Cálculos globales ──────────────────────────────────────────────────────
  const totalKm = datosFiltrados.reduce((acc, r) => acc + calcKmRecorridos(r.km_salida, r.km_regreso), 0)
  const totalCosto = datosFiltrados.reduce((acc, r) => acc + recTotalCosto(r.id, cargasFuelData), 0)
  // Litros consumidos = balance real del tanque, NO solo recargas
  const totalLitrosConsumidos = datosFiltrados.reduce((acc, r) => {
    if (!r.vehiculos?.capacidad_tanque_litros) return acc
    const l = calcLitrosConsumidos(
      r.vehiculos.capacidad_tanque_litros,
      r.combustible_salida,
      r.combustible_regreso,
      recTotalLitros(r.id, cargasFuelData)
    )
    return l > 0 ? acc + l : acc
  }, 0)
  const rendimientoPromedio = calcRendimiento(totalKm, totalLitrosConsumidos)

  const stats: StatCard[] = [
    { emoji: '🚗', label: 'Recorridos', valor: datosFiltrados.length.toString() },
    { emoji: '📍', label: 'KM totales', valor: totalKm.toLocaleString() },
    { emoji: '💰', label: 'Costo total', valor: formatMoneda(totalCosto) },
    { emoji: '⛽', label: 'Rendimiento', valor: rendimientoPromedio ? `${formatDecimal(rendimientoPromedio)} km/L` : '—' },
  ]

  // ── Agrupación temporal ────────────────────────────────────────────────────
  const esPorDia = tipo === 'dia' || tipo === 'semana'
  const unidadTemporal = tipo === 'mes' ? 'semana' : esPorDia ? 'día' : 'mes'

  const keyPeriodo = (fecha: string) => {
    if (tipo === 'dia' || tipo === 'semana') {
      return format(new Date(fecha), 'dd MMM', { locale: es })
    }
    if (tipo === 'mes') {
      const day = getDate(new Date(fecha))
      if (day <= 7) return 'Sem 1'
      if (day <= 14) return 'Sem 2'
      if (day <= 21) return 'Sem 3'
      return 'Sem 4'
    }
    return format(new Date(fecha), 'MMM yyyy', { locale: es })
  }

  // Labels ordenados completos (incluye períodos sin datos, valor 0)
  const periodLabels: string[] | null = (() => {
    if (tipo === 'dia') {
      const d = parseISO(fechaDia)
      return [
        format(subDays(d, 1), 'dd MMM', { locale: es }),
        format(d, 'dd MMM', { locale: es }),
        format(addDays(d, 1), 'dd MMM', { locale: es }),
      ]
    }
    if (tipo === 'semana') {
      const lunes = parseISO(semanaRef)
      return Array.from({ length: 7 }, (_, i) => format(addDays(lunes, i), 'dd MMM', { locale: es }))
    }
    if (tipo === 'mes') {
      return ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4']
    }
    return null
  })()

  function toOrderedChart(map: Record<string, number>): { labels: string[]; values: number[] } {
    if (periodLabels) {
      return { labels: periodLabels, values: periodLabels.map((k) => map[k] ?? 0) }
    }
    return { labels: Object.keys(map), values: Object.values(map) }
  }

  // ── KM por vehículo ────────────────────────────────────────────────────────
  const kmPorVehiculo = datosFiltrados.reduce<Record<string, number>>((acc, r) => {
    acc[r.vehiculo_codigo] = (acc[r.vehiculo_codigo] ?? 0) + calcKmRecorridos(r.km_salida, r.km_regreso)
    return acc
  }, {})
  const vehiculosOrdenados = Object.entries(kmPorVehiculo).sort((a, b) => b[1] - a[1])

  // ── KM por período ─────────────────────────────────────────────────────────
  const kmPorPeriodo = datosFiltrados.reduce<Record<string, number>>((acc, r) => {
    const key = keyPeriodo(r.fecha_salida)
    acc[key] = (acc[key] ?? 0) + calcKmRecorridos(r.km_salida, r.km_regreso)
    return acc
  }, {})

  // ── Costo por vehículo ─────────────────────────────────────────────────────
  const costoPorVehiculo = datosFiltrados.reduce<Record<string, number>>((acc, r) => {
    acc[r.vehiculo_codigo] = (acc[r.vehiculo_codigo] ?? 0) + recTotalCosto(r.id, cargasFuelData)
    return acc
  }, {})
  const vehiculosCostoOrdenados = Object.entries(costoPorVehiculo).sort((a, b) => b[1] - a[1])

  // ── Desglose vehicle × período (para gráficas apiladas) ────────────────────
  const kmPorVehiculoPeriodo = datosFiltrados.reduce<Record<string, Record<string, number>>>((acc, r) => {
    const p = keyPeriodo(r.fecha_salida)
    if (!acc[r.vehiculo_codigo]) acc[r.vehiculo_codigo] = {}
    acc[r.vehiculo_codigo][p] = (acc[r.vehiculo_codigo][p] ?? 0) + calcKmRecorridos(r.km_salida, r.km_regreso)
    return acc
  }, {})

  const costoPorVehiculoPeriodo = datosFiltrados.reduce<Record<string, Record<string, number>>>((acc, r) => {
    const p = keyPeriodo(r.fecha_salida)
    if (!acc[r.vehiculo_codigo]) acc[r.vehiculo_codigo] = {}
    acc[r.vehiculo_codigo][p] = (acc[r.vehiculo_codigo][p] ?? 0) + recTotalCosto(r.id, cargasFuelData)
    return acc
  }, {})

  // Keys de período en orden (para datasets apilados)
  const allPeriodKeys: string[] = periodLabels ?? (() => {
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const r of datosFiltrados) {
      const k = keyPeriodo(r.fecha_salida)
      if (!seen.has(k)) { seen.add(k); ordered.push(k) }
    }
    return ordered
  })()

  // ── Rendimiento por período ────────────────────────────────────────────────
  const rendAcum = datosFiltrados.reduce<Record<string, { km: number; litros: number }>>((acc, r) => {
    if (!r.vehiculos?.capacidad_tanque_litros) return acc
    const litrosConsumidos = calcLitrosConsumidos(
      r.vehiculos.capacidad_tanque_litros,
      r.combustible_salida,
      r.combustible_regreso,
      recTotalLitros(r.id, cargasFuelData)
    )
    if (litrosConsumidos <= 0) return acc
    const key = keyPeriodo(r.fecha_salida)
    if (!acc[key]) acc[key] = { km: 0, litros: 0 }
    acc[key].km += calcKmRecorridos(r.km_salida, r.km_regreso)
    acc[key].litros += litrosConsumidos
    return acc
  }, {})
  const rendLabels = Object.keys(rendAcum)
  const rendValues = rendLabels.map((k) =>
    rendAcum[k].litros > 0 ? Math.round((rendAcum[k].km / rendAcum[k].litros) * 100) / 100 : 0
  )
  const hayDatosRendimiento = rendLabels.length > 0

  // ── Litros recargados por período ──────────────────────────────────────────
  const litrosRecPorPeriodo = datosFiltrados.reduce<Record<string, number>>((acc, r) => {
    const total = recTotalLitros(r.id, cargasFuelData)
    if (!total) return acc
    const key = keyPeriodo(r.fecha_salida)
    acc[key] = (acc[key] ?? 0) + total
    return acc
  }, {})
  const hayDatosLitrosRec = Object.keys(litrosRecPorPeriodo).length > 0

  // ── Labels ─────────────────────────────────────────────────────────────────
  const labelPeriodo = tipo === 'mes' ? 'KM por semana' : esPorDia ? 'KM por día' : 'KM por mes'

  // ── Datos ordenados para gráficas por período ──────────────────────────────
  const kmPeriodoOrdenado = toOrderedChart(kmPorPeriodo)
  const rendPeriodoOrdenado = toOrderedChart(
    Object.fromEntries(rendLabels.map((k, i) => [k, rendValues[i]]))
  )
  const litrosConsPeriodoOrdenado = toOrderedChart(
    Object.fromEntries(rendLabels.map((k) => [k, Math.round(rendAcum[k].litros * 100) / 100]))
  )
  const litrosRecPeriodoOrdenado = toOrderedChart(
    Object.fromEntries(Object.entries(litrosRecPorPeriodo).map(([k, v]) => [k, Math.round(v * 100) / 100]))
  )

  // ── Resumen por vehículo (tabla + exportación) ─────────────────────────────
  const resumenVehiculos: ResumenVehiculo[] = vehiculosOrdenados.map(([vehiculo, km]) => {
    const apodo = apodoMap[vehiculo] ?? datos.find((r) => r.vehiculo_codigo === vehiculo)?.vehiculos?.apodo ?? null
    const litrosCargados = datosFiltrados
      .filter((r) => r.vehiculo_codigo === vehiculo)
      .reduce((acc, r) => acc + recTotalLitros(r.id, cargasFuelData), 0)
    const litrosConsumidos = datosFiltrados
      .filter((r) => r.vehiculo_codigo === vehiculo && r.vehiculos?.capacidad_tanque_litros)
      .reduce((acc, r) => {
        const l = calcLitrosConsumidos(
          r.vehiculos!.capacidad_tanque_litros,
          r.combustible_salida,
          r.combustible_regreso,
          recTotalLitros(r.id, cargasFuelData)
        )
        return l > 0 ? acc + l : acc
      }, 0)
    return {
      codigo: vehiculo,
      placa: placaMap[vehiculo] ?? null,
      apodo,
      km,
      litrosCargados,
      litrosConsumidos,
      rendimiento: calcRendimiento(km, litrosConsumidos),
      costo: costoPorVehiculo[vehiculo] ?? 0,
    }
  })

  // ── Exportación ────────────────────────────────────────────────────────────
  function descripcionPeriodo(): string {
    switch (tipo) {
      case 'dia':
        return format(parseISO(fechaDia), "d 'de' MMMM 'de' yyyy", { locale: es })
      case 'semana':
        return `Semana del ${format(parseISO(semanaRef), 'd MMM', { locale: es })} al ${format(
          endOfWeek(parseISO(semanaRef), { weekStartsOn: 1 }), 'd MMM yyyy', { locale: es }
        )}`
      case 'mes':
        return format(parseISO(`${mesAnio}-01`), 'MMMM yyyy', { locale: es })
      case 'rango':
        return `Del ${rangoDesde} al ${rangoHasta}`
    }
  }

  function datosParaExportar(): DatosIndicadores {
    return {
      filtros: [
        { etiqueta: 'Período', valor: descripcionPeriodo() },
        { etiqueta: 'Vehículo', valor: vehiculoFiltro ? labelVehiculo(vehiculoFiltro) : 'Todos' },
      ],
      unidadPeriodo: `por ${unidadTemporal}`,
      tipoGrafica,
      vehiculoFiltrado: Boolean(vehiculoFiltro),
      totales: {
        recorridos: datosFiltrados.length,
        km: totalKm,
        litrosRecargados: Object.values(litrosRecPorPeriodo).reduce((a, b) => a + b, 0),
        litrosConsumidos: totalLitrosConsumidos,
        costo: totalCosto,
        rendimientoPromedio: rendimientoPromedio,
      },
      kmPorVehiculo: {
        labels: vehiculosOrdenados.map(([v]) => labelVehiculo(v)),
        values: vehiculosOrdenados.map(([, km]) => km),
      },
      kmPorPeriodo: {
        labels: Object.keys(kmPorPeriodo),
        values: Object.values(kmPorPeriodo),
      },
      rendimientoPorPeriodo: { labels: rendLabels, values: rendValues },
      litrosConsumidosPorPeriodo: {
        labels: rendLabels,
        values: rendLabels.map((k) => Math.round(rendAcum[k].litros * 100) / 100),
      },
      litrosRecargadosPorPeriodo: {
        labels: Object.keys(litrosRecPorPeriodo),
        values: Object.values(litrosRecPorPeriodo).map((v) => Math.round(v * 100) / 100),
      },
      costoPorVehiculo: {
        labels: vehiculosCostoOrdenados.map(([v]) => labelVehiculo(v)),
        values: vehiculosCostoOrdenados.map(([, c]) => c),
      },
      resumenVehiculos,
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-blue-600 text-white px-4 py-5 shadow flex items-center gap-3">
        <button
          onClick={() => router.push('/')}
          className="text-blue-200 hover:text-white transition-colors"
          aria-label="Volver al inicio"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold">Indicadores</h1>
      </header>

      <div className="px-4 py-4 w-full max-w-6xl mx-auto space-y-6">

        {/* Selector de período */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <div className="grid grid-cols-4 gap-1 bg-gray-100 rounded-xl p-1">
            {(['dia', 'semana', 'mes', 'rango'] as TipoFiltro[]).map((t) => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tipo === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
                }`}
              >
                {t === 'dia' ? 'Día' : t === 'semana' ? 'Semana' : t === 'mes' ? 'Mes' : 'Rango'}
              </button>
            ))}
          </div>

          {tipo === 'dia' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setFechaDia(hoy())}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    fechaDia === hoy() ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >Hoy</button>
                <button
                  onClick={() => setFechaDia(format(subDays(new Date(), 1), 'yyyy-MM-dd'))}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    fechaDia === format(subDays(new Date(), 1), 'yyyy-MM-dd') ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >Ayer</button>
              </div>
              <input type="date" value={fechaDia} max={hoy()}
                onChange={(e) => e.target.value && setFechaDia(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {tipo === 'semana' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setSemanaRef(inicioSemanaActual())}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    semanaRef === inicioSemanaActual() ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >Esta semana</button>
                <button
                  onClick={() => setSemanaRef(format(startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }), 'yyyy-MM-dd'))}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    semanaRef === format(startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }), 'yyyy-MM-dd') ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >Semana pasada</button>
              </div>
              <p className="text-xs text-gray-500 text-center">Elige cualquier día de la semana:</p>
              <input type="date" value={semanaRef} max={hoy()}
                onChange={(e) => {
                  if (e.target.value)
                    setSemanaRef(format(startOfWeek(parseISO(e.target.value), { weekStartsOn: 1 }), 'yyyy-MM-dd'))
                }}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 text-center">
                {format(parseISO(semanaRef), "d 'de' MMM", { locale: es })}
                {' – '}
                {format(endOfWeek(parseISO(semanaRef), { weekStartsOn: 1 }), "d 'de' MMM yyyy", { locale: es })}
              </p>
            </div>
          )}

          {tipo === 'mes' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setMesAnio(mesAnioActual())}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    mesAnio === mesAnioActual() ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >Este mes</button>
                <button
                  onClick={() => setMesAnio(format(subMonths(new Date(), 1), 'yyyy-MM'))}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    mesAnio === format(subMonths(new Date(), 1), 'yyyy-MM') ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >Mes anterior</button>
              </div>
              <input type="month" value={mesAnio} max={mesAnioActual()}
                onChange={(e) => e.target.value && setMesAnio(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {tipo === 'rango' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => { setRangoDesde(format(subDays(new Date(), 6), 'yyyy-MM-dd')); setRangoHasta(hoy()) }}
                  className="flex-1 py-2 rounded-xl text-xs font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
                >Últimos 7 días</button>
                <button
                  onClick={() => { setRangoDesde(format(subDays(new Date(), 29), 'yyyy-MM-dd')); setRangoHasta(hoy()) }}
                  className="flex-1 py-2 rounded-xl text-xs font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
                >Últimos 30 días</button>
              </div>
              <div className="flex gap-2 items-center">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Desde</label>
                  <input type="date" value={rangoDesde} max={rangoHasta}
                    onChange={(e) => e.target.value && setRangoDesde(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <span className="text-gray-400 mt-5">→</span>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Hasta</label>
                  <input type="date" value={rangoHasta} min={rangoDesde} max={hoy()}
                    onChange={(e) => e.target.value && setRangoHasta(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Filtro por vehículo */}
        {vehiculos.length > 1 && (
          <div className="relative">
            <select
              value={vehiculoFiltro}
              onChange={(e) => setVehiculoFiltro(e.target.value)}
              className="w-full appearance-none bg-white border border-gray-300 rounded-xl px-4 py-2.5 pr-10 text-sm text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
            >
              <option value="">Todos los vehículos</option>
              {vehiculos.map((v) => {
                const tieneDatos = datos.some((r) => r.vehiculo_codigo === v.codigo)
                const label = [v.codigo, v.placa, v.apodo].filter(Boolean).join(' — ')
                return (
                  <option key={v.codigo} value={v.codigo}>
                    {label}{!tieneDatos ? ' (sin datos en este período)' : ''}
                  </option>
                )
              })}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
          </div>
        )}

        {error && <ErrorMessage mensaje={error} />}

        {datosFiltrados.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <span className="text-4xl">📊</span>
            <p className="mt-2 text-sm">
              {datos.length === 0
                ? 'No hay datos para este período'
                : 'No hay datos para este vehículo en el período'}
            </p>
          </div>
        ) : (
          <>
            {/* Stats cards */}
            <div className="grid grid-cols-2 gap-3">
              {stats.map((s) => (
                <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4">
                  <p className="text-xl">{s.emoji}</p>
                  <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                  <p className="text-lg font-bold text-gray-800 mt-0.5">{s.valor}</p>
                </div>
              ))}
            </div>

            {/* Toggle tipo de gráfica */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 shrink-0">Ver gráficas como:</span>
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-1">
                {(['barras', 'tendencia', 'ambas'] as TipoGrafica[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTipoGrafica(t)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      tipoGrafica === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    {t === 'barras' ? '▪ Barras' : t === 'tendencia' ? '↗ Tendencia' : '⚡ Ambas'}
                  </button>
                ))}
              </div>
            </div>

            {/* Exportar indicadores */}
            <ExportButtons
              onCsv={() => exportarIndicadoresCsv(datosParaExportar())}
              onXlsx={() => exportarIndicadoresXlsx(datosParaExportar())}
              onPdf={() => exportarIndicadoresPdf(datosParaExportar())}
            />

            {/* KM por vehículo (apilado por período + tendencia opcional) */}
            {!vehiculoFiltro && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">KM por vehículo</h2>
                <Chart
                  type={tipoGrafica === 'tendencia' ? 'line' : 'bar'}
                  data={{
                    labels: vehiculosOrdenados.map(([v]) => labelVehiculo(v)),
                    datasets: buildDatasetsStackedConTendencia(
                      vehiculosOrdenados.map(([v]) => v),
                      allPeriodKeys,
                      kmPorVehiculoPeriodo,
                      tipoGrafica
                    ),
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  options={(tipoGrafica === 'tendencia' ? chartOptionsConLeyenda : {
                    ...chartOptionsStacked,
                    plugins: {
                      ...chartOptionsStacked.plugins,
                      stackedTotal: {
                        totals: vehiculosOrdenados.map(([v]) =>
                          allPeriodKeys.reduce((s, pk) => s + (kmPorVehiculoPeriodo[v]?.[pk] ?? 0), 0)
                        ),
                        prefix: '',
                      },
                    },
                  }) as any}
                  plugins={tipoGrafica !== 'tendencia' ? [stackedTotalPlugin] : undefined}
                />
              </div>
            )}

            {/* KM por período */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">{labelPeriodo}</h2>
              <Chart
                type={tipoGrafica === 'tendencia' ? 'line' : 'bar'}
                data={{
                  labels: kmPeriodoOrdenado.labels,
                  datasets: buildDatasets(
                    kmPeriodoOrdenado.values,
                    labelPeriodo, 'rgba(16, 185, 129, 0.7)', tipoGrafica
                  ),
                }}
                options={tipoGrafica === 'ambas' ? chartOptionsConLeyenda : chartOptions}
              />
            </div>

            {/* Rendimiento por período */}
            {hayDatosRendimiento && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  Rendimiento por {unidadTemporal} (km/L)
                </h2>
                <Chart
                  type={tipoGrafica === 'tendencia' ? 'line' : 'bar'}
                  data={{
                    labels: rendPeriodoOrdenado.labels,
                    datasets: buildDatasets(
                      rendPeriodoOrdenado.values,
                      'km/L', 'rgba(139, 92, 246, 0.7)', tipoGrafica
                    ),
                  }}
                  options={tipoGrafica === 'ambas' ? chartOptionsConLeyenda : chartOptions}
                />
              </div>
            )}

            {/* Litros consumidos por período */}
            {hayDatosRendimiento && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  Litros consumidos por {unidadTemporal}
                </h2>
                <Chart
                  type={tipoGrafica === 'tendencia' ? 'line' : 'bar'}
                  data={{
                    labels: litrosConsPeriodoOrdenado.labels,
                    datasets: buildDatasets(
                      litrosConsPeriodoOrdenado.values,
                      'Litros consumidos', 'rgba(239, 68, 68, 0.7)', tipoGrafica
                    ),
                  }}
                  options={tipoGrafica === 'ambas' ? chartOptionsConLeyenda : chartOptions}
                />
              </div>
            )}

            {/* Litros recargados por período */}
            {hayDatosLitrosRec && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  Litros recargados por {unidadTemporal}
                </h2>
                <Chart
                  type={tipoGrafica === 'tendencia' ? 'line' : 'bar'}
                  data={{
                    labels: litrosRecPeriodoOrdenado.labels,
                    datasets: buildDatasets(
                      litrosRecPeriodoOrdenado.values,
                      'Litros recargados', 'rgba(20, 184, 166, 0.7)', tipoGrafica
                    ),
                  }}
                  options={tipoGrafica === 'ambas' ? chartOptionsConLeyenda : chartOptions}
                />
              </div>
            )}

            {/* Costo por vehículo (apilado por período + tendencia opcional) */}
            {totalCosto > 0 && !vehiculoFiltro && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">Costo de combustible por vehículo</h2>
                <Chart
                  type={tipoGrafica === 'tendencia' ? 'line' : 'bar'}
                  data={{
                    labels: vehiculosCostoOrdenados.map(([v]) => labelVehiculo(v)),
                    datasets: buildDatasetsStackedConTendencia(
                      vehiculosCostoOrdenados.map(([v]) => v),
                      allPeriodKeys,
                      costoPorVehiculoPeriodo,
                      tipoGrafica
                    ),
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  options={(tipoGrafica === 'tendencia' ? chartOptionsConLeyenda : {
                    ...chartOptionsStacked,
                    plugins: {
                      ...chartOptionsStacked.plugins,
                      stackedTotal: {
                        totals: vehiculosCostoOrdenados.map(([v]) =>
                          allPeriodKeys.reduce((s, pk) => s + (costoPorVehiculoPeriodo[v]?.[pk] ?? 0), 0)
                        ),
                        prefix: '$',
                      },
                    },
                  }) as any}
                  plugins={tipoGrafica !== 'tendencia' ? [stackedTotalPlugin] : undefined}
                />
              </div>
            )}

            {/* Tabla de rendimiento por vehículo */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Resumen por vehículo</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <th className="px-4 py-2 text-left whitespace-nowrap">Vehículo</th>
                      <th className="px-4 py-2 text-left whitespace-nowrap">Apodo</th>
                      <th className="px-4 py-2 text-right whitespace-nowrap">KM</th>
                      <th className="px-4 py-2 text-right whitespace-nowrap">L. recargados</th>
                      <th className="px-4 py-2 text-right whitespace-nowrap">L. consumidos</th>
                      <th className="px-4 py-2 text-right whitespace-nowrap">Rend.</th>
                      <th className="px-4 py-2 text-right whitespace-nowrap">Costo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {resumenVehiculos.map((v) => (
                      <tr key={v.codigo} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium whitespace-nowrap">
                          <div>{v.codigo}</div>
                          {v.placa && <div className="text-xs text-gray-400 font-normal">{v.placa}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{v.apodo ?? '—'}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">{v.km.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">{v.litrosCargados ? formatDecimal(v.litrosCargados) : '—'}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">{v.litrosConsumidos > 0 ? formatDecimal(v.litrosConsumidos) : '—'}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {v.rendimiento ? `${formatDecimal(v.rendimiento)} km/L` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">{v.costo ? formatMoneda(v.costo) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-xs text-gray-400 text-center pb-6">
              Solo recorridos cerrados · L. consumidos = balance real del tanque · L. recargados = carga en gasolinera
            </p>
          </>
        )}
      </div>
    </div>
  )
}
