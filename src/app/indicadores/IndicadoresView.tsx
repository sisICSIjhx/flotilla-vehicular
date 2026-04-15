'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  LineController,
  BarController,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
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
  format,
  parseISO,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import { calcKmRecorridos, calcImporte, calcRendimiento } from '@/lib/calculations'
import { formatMoneda, formatDecimal } from '@/utils/formatters'
import Loading from '@/components/common/Loading'
import ErrorMessage from '@/components/common/ErrorMessage'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, BarController,
  LineElement, LineController, PointElement,
  Title, Tooltip, Legend
)

type TipoFiltro = 'dia' | 'semana' | 'mes' | 'rango'
type TipoGrafica = 'barras' | 'tendencia' | 'ambas'

interface RecorridoCerrado {
  vehiculo_codigo: string
  fecha_salida: string
  km_salida: number
  km_regreso: number
  litros_cargados: number | null
  precio_litro: number | null
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

function buildDatasets(
  data: number[],
  label: string,
  rgba: string,
  tipo: TipoGrafica
) {
  const solid = rgba.replace(/[\d.]+\)$/, '1)')
  const faded = rgba.replace(/[\d.]+\)$/, '0.45)')
  const bar = {
    type: 'bar' as const,
    label,
    data,
    backgroundColor: tipo === 'ambas' ? faded : rgba,
    borderRadius: 6,
  }
  const line = {
    type: 'line' as const,
    label,
    data,
    borderColor: solid,
    backgroundColor: 'transparent',
    borderWidth: 2.5,
    pointRadius: 4,
    pointBackgroundColor: solid,
    tension: 0.4,
  }
  if (tipo === 'barras') return [bar]
  if (tipo === 'tendencia') return [line]
  return [bar, { ...line, label: `${label} (tendencia)` }]
}

const chartOptions = {
  responsive: true,
  plugins: { legend: { display: false } },
  scales: { y: { beginAtZero: true } },
}

const chartOptionsConLeyenda = {
  responsive: true,
  plugins: { legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 11 } } } },
  scales: { y: { beginAtZero: true } },
}

export default function IndicadoresView() {
  const router = useRouter()
  const [datos, setDatos] = useState<RecorridoCerrado[]>([])
  const [vehiculos, setVehiculos] = useState<string[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      .select('codigo')
      .eq('estado', 'activo')
      .order('codigo', { ascending: true })
    if (data) setVehiculos(data.map((v: { codigo: string }) => v.codigo))
  }

  function calcularRango(): { desde: string; hasta: string } {
    switch (tipo) {
      case 'dia': {
        const d = parseISO(fechaDia)
        return { desde: startOfDay(d).toISOString(), hasta: endOfDay(d).toISOString() }
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
        .select('vehiculo_codigo, fecha_salida, km_salida, km_regreso, litros_cargados, precio_litro')
        .eq('estado', 'cerrado')
        .gte('fecha_salida', desde)
        .lte('fecha_salida', hasta)
        .order('fecha_salida', { ascending: true })
      if (qError) throw new Error(qError.message)
      setDatos((data ?? []) as RecorridoCerrado[])
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

  // ── Cálculos globales ──────────────────────────────────────────────────────
  const totalKm = datosFiltrados.reduce((acc, r) => acc + calcKmRecorridos(r.km_salida, r.km_regreso), 0)
  const totalLitros = datosFiltrados.reduce((acc, r) => acc + (r.litros_cargados ?? 0), 0)
  const totalCosto = datosFiltrados.reduce(
    (acc, r) => acc + (r.litros_cargados && r.precio_litro ? calcImporte(r.litros_cargados, r.precio_litro) : 0),
    0
  )
  const rendimientoPromedio = calcRendimiento(totalKm, totalLitros)

  const stats: StatCard[] = [
    { emoji: '🚗', label: 'Recorridos', valor: datosFiltrados.length.toString() },
    { emoji: '📍', label: 'KM totales', valor: totalKm.toLocaleString() },
    { emoji: '💰', label: 'Costo total', valor: formatMoneda(totalCosto) },
    { emoji: '⛽', label: 'Rendimiento', valor: rendimientoPromedio ? `${formatDecimal(rendimientoPromedio)} km/L` : '—' },
  ]

  // ── Agrupación temporal ────────────────────────────────────────────────────
  const esPorDia = tipo === 'dia' || tipo === 'semana'
  const keyPeriodo = (fecha: string) =>
    esPorDia
      ? format(new Date(fecha), 'dd MMM', { locale: es })
      : format(new Date(fecha), 'MMM yyyy', { locale: es })

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
    acc[r.vehiculo_codigo] = (acc[r.vehiculo_codigo] ?? 0) +
      (r.litros_cargados && r.precio_litro ? calcImporte(r.litros_cargados, r.precio_litro) : 0)
    return acc
  }, {})
  const vehiculosCostoOrdenados = Object.entries(costoPorVehiculo).sort((a, b) => b[1] - a[1])

  // ── Rendimiento por período ────────────────────────────────────────────────
  const rendAcum = datosFiltrados.reduce<Record<string, { km: number; litros: number }>>((acc, r) => {
    if (!r.litros_cargados) return acc
    const key = keyPeriodo(r.fecha_salida)
    if (!acc[key]) acc[key] = { km: 0, litros: 0 }
    acc[key].km += calcKmRecorridos(r.km_salida, r.km_regreso)
    acc[key].litros += r.litros_cargados
    return acc
  }, {})
  const rendLabels = Object.keys(rendAcum)
  const rendValues = rendLabels.map((k) =>
    rendAcum[k].litros > 0 ? Math.round((rendAcum[k].km / rendAcum[k].litros) * 100) / 100 : 0
  )
  const hayDatosRendimiento = rendLabels.length > 0

  // ── Labels ─────────────────────────────────────────────────────────────────
  const labelPeriodo = esPorDia ? 'KM por día' : 'KM por mes'

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-blue-600 text-white px-4 py-5 shadow">
        <button onClick={() => router.push('/')} className="text-blue-200 text-sm mb-2">
          ← Inicio
        </button>
        <h1 className="text-xl font-bold">Indicadores</h1>
      </header>

      <div className="px-4 py-4 max-w-3xl mx-auto w-full space-y-6">

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
                const tieneDatos = datos.some((r) => r.vehiculo_codigo === v)
                return (
                  <option key={v} value={v}>
                    {v}{!tieneDatos ? ' (sin datos en este período)' : ''}
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

            {/* KM por vehículo */}
            {!vehiculoFiltro && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">KM por vehículo</h2>
                <Chart
                  type={tipoGrafica === 'tendencia' ? 'line' : 'bar'}
                  data={{
                    labels: vehiculosOrdenados.map(([v]) => v),
                    datasets: buildDatasets(
                      vehiculosOrdenados.map(([, km]) => km),
                      'KM recorridos', 'rgba(37, 99, 235, 0.7)', tipoGrafica
                    ),
                  }}
                  options={tipoGrafica === 'ambas' ? chartOptionsConLeyenda : chartOptions}
                />
              </div>
            )}

            {/* KM por período */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">{labelPeriodo}</h2>
              <Chart
                type={tipoGrafica === 'tendencia' ? 'line' : 'bar'}
                data={{
                  labels: Object.keys(kmPorPeriodo),
                  datasets: buildDatasets(
                    Object.values(kmPorPeriodo),
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
                  Rendimiento {esPorDia ? 'por día' : 'por mes'} (km/L)
                </h2>
                <Chart
                  type={tipoGrafica === 'tendencia' ? 'line' : 'bar'}
                  data={{
                    labels: rendLabels,
                    datasets: buildDatasets(
                      rendValues,
                      'km/L', 'rgba(139, 92, 246, 0.7)', tipoGrafica
                    ),
                  }}
                  options={tipoGrafica === 'ambas' ? chartOptionsConLeyenda : chartOptions}
                />
              </div>
            )}

            {/* Costo por vehículo */}
            {totalCosto > 0 && !vehiculoFiltro && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">Costo de combustible por vehículo</h2>
                <Chart
                  type={tipoGrafica === 'tendencia' ? 'line' : 'bar'}
                  data={{
                    labels: vehiculosCostoOrdenados.map(([v]) => v),
                    datasets: buildDatasets(
                      vehiculosCostoOrdenados.map(([, c]) => c),
                      'Costo ($)', 'rgba(245, 158, 11, 0.7)', tipoGrafica
                    ),
                  }}
                  options={tipoGrafica === 'ambas' ? chartOptionsConLeyenda : chartOptions}
                />
              </div>
            )}

            {/* Tabla de rendimiento por vehículo */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Resumen por vehículo</h2>
              </div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <th className="px-4 py-2 text-left">Vehículo</th>
                    <th className="px-4 py-2 text-right">KM</th>
                    <th className="px-4 py-2 text-right">Litros</th>
                    <th className="px-4 py-2 text-right">Rend.</th>
                    <th className="px-4 py-2 text-right">Costo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vehiculosOrdenados.map(([vehiculo, km]) => {
                    const litros = datosFiltrados
                      .filter((r) => r.vehiculo_codigo === vehiculo)
                      .reduce((acc, r) => acc + (r.litros_cargados ?? 0), 0)
                    const costo = costoPorVehiculo[vehiculo] ?? 0
                    const rend = calcRendimiento(km, litros)
                    return (
                      <tr key={vehiculo} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{vehiculo}</td>
                        <td className="px-4 py-3 text-right">{km.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">{litros ? formatDecimal(litros) : '—'}</td>
                        <td className="px-4 py-3 text-right">
                          {rend ? `${formatDecimal(rend)} km/L` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">{costo ? formatMoneda(costo) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-gray-400 text-center pb-6">
              Solo recorridos cerrados · Rendimiento solo cuando se registran litros
            </p>
          </>
        )}
      </div>
    </div>
  )
}
