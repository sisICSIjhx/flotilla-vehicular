'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { subMonths, startOfMonth, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import { calcKmRecorridos, calcImporte, calcRendimiento } from '@/lib/calculations'
import { formatMoneda, formatDecimal } from '@/utils/formatters'
import Loading from '@/components/common/Loading'
import ErrorMessage from '@/components/common/ErrorMessage'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

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
  sub?: string
  emoji: string
}

export default function IndicadoresView() {
  const router = useRouter()
  const [datos, setDatos] = useState<RecorridoCerrado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meses, setMeses] = useState(3) // últimos N meses

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meses])

  async function cargar() {
    setCargando(true)
    setError(null)
    try {
      const desde = startOfMonth(subMonths(new Date(), meses - 1)).toISOString()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: qError } = await (supabase.from('recorridos') as any)
        .select('vehiculo_codigo, fecha_salida, km_salida, km_regreso, litros_cargados, precio_litro')
        .eq('estado', 'cerrado')
        .gte('fecha_salida', desde)
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

  // ── Cálculos globales ──────────────────────────────────────────────────────

  const totalKm = datos.reduce((acc, r) => acc + calcKmRecorridos(r.km_salida, r.km_regreso), 0)
  const totalLitros = datos.reduce((acc, r) => acc + (r.litros_cargados ?? 0), 0)
  const totalCosto = datos.reduce(
    (acc, r) =>
      acc + (r.litros_cargados && r.precio_litro ? calcImporte(r.litros_cargados, r.precio_litro) : 0),
    0
  )
  const rendimientoPromedio = calcRendimiento(totalKm, totalLitros)

  const stats: StatCard[] = [
    { emoji: '🚗', label: 'Recorridos', valor: datos.length.toString() },
    { emoji: '📍', label: 'KM totales', valor: totalKm.toLocaleString() },
    { emoji: '💰', label: 'Costo total', valor: formatMoneda(totalCosto) },
    {
      emoji: '⛽',
      label: 'Rendimiento',
      valor: rendimientoPromedio ? `${formatDecimal(rendimientoPromedio)} km/L` : '—',
    },
  ]

  // ── KM por vehículo ────────────────────────────────────────────────────────

  const kmPorVehiculo = datos.reduce<Record<string, number>>((acc, r) => {
    const km = calcKmRecorridos(r.km_salida, r.km_regreso)
    acc[r.vehiculo_codigo] = (acc[r.vehiculo_codigo] ?? 0) + km
    return acc
  }, {})
  const vehiculosOrdenados = Object.entries(kmPorVehiculo).sort((a, b) => b[1] - a[1])

  const chartKmVehiculo = {
    labels: vehiculosOrdenados.map(([v]) => v),
    datasets: [
      {
        label: 'KM recorridos',
        data: vehiculosOrdenados.map(([, km]) => km),
        backgroundColor: 'rgba(37, 99, 235, 0.7)',
        borderRadius: 6,
      },
    ],
  }

  // ── KM por mes ─────────────────────────────────────────────────────────────

  const kmPorMes = datos.reduce<Record<string, number>>((acc, r) => {
    const mes = format(new Date(r.fecha_salida), 'MMM yyyy', { locale: es })
    const km = calcKmRecorridos(r.km_salida, r.km_regreso)
    acc[mes] = (acc[mes] ?? 0) + km
    return acc
  }, {})

  const chartKmMes = {
    labels: Object.keys(kmPorMes),
    datasets: [
      {
        label: 'KM por mes',
        data: Object.values(kmPorMes),
        backgroundColor: 'rgba(16, 185, 129, 0.7)',
        borderRadius: 6,
      },
    ],
  }

  // ── Costo por vehículo ─────────────────────────────────────────────────────

  const costoPorVehiculo = datos.reduce<Record<string, number>>((acc, r) => {
    const costo =
      r.litros_cargados && r.precio_litro ? calcImporte(r.litros_cargados, r.precio_litro) : 0
    acc[r.vehiculo_codigo] = (acc[r.vehiculo_codigo] ?? 0) + costo
    return acc
  }, {})
  const vehiculosCostoOrdenados = Object.entries(costoPorVehiculo).sort((a, b) => b[1] - a[1])

  const chartCostoVehiculo = {
    labels: vehiculosCostoOrdenados.map(([v]) => v),
    datasets: [
      {
        label: 'Costo ($)',
        data: vehiculosCostoOrdenados.map(([, c]) => c),
        backgroundColor: 'rgba(245, 158, 11, 0.7)',
        borderRadius: 6,
      },
    ],
  }

  const chartOptions = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } },
  }

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
        <div className="flex gap-2">
          {[1, 3, 6].map((m) => (
            <button
              key={m}
              onClick={() => setMeses(m)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                meses === m
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {m === 1 ? 'Este mes' : `${m} meses`}
            </button>
          ))}
        </div>

        {error && <ErrorMessage mensaje={error} />}

        {datos.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <span className="text-4xl">📊</span>
            <p className="mt-2 text-sm">No hay datos para este período</p>
          </div>
        ) : (
          <>
            {/* Stats cards */}
            <div className="grid grid-cols-2 gap-3">
              {stats.map((s) => (
                <div
                  key={s.label}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4"
                >
                  <p className="text-xl">{s.emoji}</p>
                  <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                  <p className="text-lg font-bold text-gray-800 mt-0.5">{s.valor}</p>
                </div>
              ))}
            </div>

            {/* KM por vehículo */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">KM por vehículo</h2>
              <Bar data={chartKmVehiculo} options={chartOptions} />
            </div>

            {/* KM por mes */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">KM por mes</h2>
              <Bar data={chartKmMes} options={chartOptions} />
            </div>

            {/* Costo por vehículo */}
            {totalCosto > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">Costo de combustible por vehículo</h2>
                <Bar data={chartCostoVehiculo} options={chartOptions} />
              </div>
            )}

            {/* Tabla de rendimiento por vehículo */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Rendimiento por vehículo</h2>
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
                    const litros = datos
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
              Solo recorridos cerrados con datos completos
            </p>
          </>
        )}
      </div>
    </div>
  )
}
