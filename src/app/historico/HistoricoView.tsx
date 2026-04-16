'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { startOfWeek, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { calcKmRecorridos, calcImporte, calcLitrosConsumidos, calcRendimiento } from '@/lib/calculations'
import { formatFecha, formatMoneda, formatDecimal } from '@/utils/formatters'
import { combustibleLabel } from '@/lib/constants'
import Loading from '@/components/common/Loading'
import ErrorMessage from '@/components/common/ErrorMessage'

interface RecorridoHistorico {
  id: string
  vehiculo_codigo: string
  estado: string
  fecha_salida: string
  fecha_regreso: string | null
  km_salida: number
  km_regreso: number | null
  combustible_salida: number
  combustible_regreso: number | null
  litros_cargados: number | null
  precio_litro: number | null
  conductores: { nombre: string } | null
  centros_costo: { nombre: string } | null
  vehiculos: { capacidad_tanque_litros: number } | null
}

type Periodo = 'todo' | 'semana' | 'mes' | 'mes_anterior'

const PERIODOS = [
  { value: 'todo', label: 'Todo' },
  { value: 'semana', label: 'Esta semana' },
  { value: 'mes', label: 'Este mes' },
  { value: 'mes_anterior', label: 'Mes anterior' },
]

export default function HistoricoView() {
  const router = useRouter()
  const [registros, setRegistros] = useState<RecorridoHistorico[]>([])
  const [vehiculos, setVehiculos] = useState<string[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filtroVehiculo, setFiltroVehiculo] = useState('')
  const [filtroPeriodo, setFiltroPeriodo] = useState<Periodo>('todo')

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroVehiculo, filtroPeriodo])

  async function cargar() {
    setCargando(true)
    setError(null)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase.from('recorridos') as any)
        .select(`
          id, vehiculo_codigo, estado, fecha_salida, fecha_regreso,
          km_salida, km_regreso, combustible_salida, combustible_regreso,
          litros_cargados, precio_litro,
          conductores(nombre),
          centros_costo(nombre),
          vehiculos(capacidad_tanque_litros)
        `)
        .order('fecha_salida', { ascending: false })
        .limit(50)

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

      const { data, error: qError } = await query
      if (qError) throw new Error(qError.message)

      const rows = (data ?? []) as RecorridoHistorico[]
      setRegistros(rows)

      // Extraer vehículos únicos para el filtro
      const unicos = [...new Set(rows.map((r) => r.vehiculo_codigo))].sort()
      setVehiculos(unicos)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar histórico')
    } finally {
      setCargando(false)
    }
  }

  // Totales de la vista actual (solo cerrados)
  const cerrados = registros.filter((r) => r.estado === 'cerrado')
  const totalKm = cerrados.reduce(
    (acc, r) => acc + (r.km_regreso != null ? calcKmRecorridos(r.km_salida, r.km_regreso) : 0),
    0
  )
  const totalCosto = cerrados.reduce(
    (acc, r) =>
      acc + (r.litros_cargados && r.precio_litro ? calcImporte(r.litros_cargados, r.precio_litro) : 0),
    0
  )

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-blue-600 text-white px-4 py-5 shadow">
        <button onClick={() => router.push('/')} className="text-blue-200 text-sm mb-2">
          ← Inicio
        </button>
        <h1 className="text-xl font-bold">Histórico de recorridos</h1>
      </header>

      <div className="px-4 py-4 max-w-5xl mx-auto w-full space-y-4">
        {/* Filtros */}
        <div className="flex flex-wrap gap-3">
          <select
            value={filtroVehiculo}
            onChange={(e) => setFiltroVehiculo(e.target.value)}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todos los vehículos</option>
            {vehiculos.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>

          <div className="flex gap-1 flex-wrap">
            {PERIODOS.map((p) => (
              <button
                key={p.value}
                onClick={() => setFiltroPeriodo(p.value as Periodo)}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  filtroPeriodo === p.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Resumen */}
        {!cargando && cerrados.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-3 text-center">
              <p className="text-xs text-gray-500">Recorridos</p>
              <p className="text-lg font-bold text-gray-800">{cerrados.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-3 text-center">
              <p className="text-xs text-gray-500">KM totales</p>
              <p className="text-lg font-bold text-gray-800">{totalKm.toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-3 text-center">
              <p className="text-xs text-gray-500">Costo total</p>
              <p className="text-lg font-bold text-gray-800">{formatMoneda(totalCosto)}</p>
            </div>
          </div>
        )}

        {error && <ErrorMessage mensaje={error} />}

        {cargando ? (
          <Loading texto="Cargando registros..." />
        ) : registros.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <span className="text-4xl">📋</span>
            <p className="mt-2 text-sm">No hay registros para este filtro</p>
          </div>
        ) : (
          /* Tabla con scroll horizontal en mobile */
          <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm">
            <table className="min-w-full bg-white text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                  <th className="px-3 py-3 text-left whitespace-nowrap">Vehículo</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Conductor</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Salida</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Regreso</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">KM sal.</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">KM reg.</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">KM rec.</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">L. recargados</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">L. consumidos</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Costo</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Rend.</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {registros.map((r) => {
                  const kmRec = r.km_regreso != null ? calcKmRecorridos(r.km_salida, r.km_regreso) : null
                  const costo =
                    r.litros_cargados && r.precio_litro
                      ? calcImporte(r.litros_cargados, r.precio_litro)
                      : null
                  const litrosConsumidos =
                    kmRec != null &&
                    r.combustible_regreso != null &&
                    r.vehiculos?.capacidad_tanque_litros
                      ? calcLitrosConsumidos(
                          r.vehiculos.capacidad_tanque_litros,
                          r.combustible_salida,
                          r.combustible_regreso,
                          r.litros_cargados ?? 0
                        )
                      : null
                  const rend =
                    kmRec != null && litrosConsumidos != null && litrosConsumidos > 0
                      ? calcRendimiento(kmRec, litrosConsumidos)
                      : null

                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 font-medium whitespace-nowrap">{r.vehiculo_codigo}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                        {r.conductores?.nombre ?? '—'}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                        {formatFecha(r.fecha_salida)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                        {r.fecha_regreso ? formatFecha(r.fecha_regreso) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {r.km_salida.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {r.km_regreso?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-right font-medium whitespace-nowrap">
                        {kmRec != null ? kmRec.toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {r.litros_cargados ? formatDecimal(r.litros_cargados) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {litrosConsumidos != null && litrosConsumidos > 0 ? formatDecimal(litrosConsumidos) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {costo != null ? formatMoneda(costo) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {rend != null ? `${formatDecimal(rend)} km/L` : '—'}
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            r.estado === 'cerrado'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}
                        >
                          {r.estado === 'cerrado' ? 'Cerrado' : 'En ruta'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center pb-6">Mostrando máximo 50 registros</p>
      </div>
    </div>
  )
}
