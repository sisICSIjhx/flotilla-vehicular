'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { startOfWeek, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { calcKmRecorridos, calcImporte, calcLitrosConsumidos, calcRendimiento } from '@/lib/calculations'
import { formatFecha, formatMoneda, formatDecimal } from '@/utils/formatters'
import { combustibleLabel } from '@/lib/constants'
import { getPublicUrl } from '@/utils/storage'
import Loading from '@/components/common/Loading'
import ErrorMessage from '@/components/common/ErrorMessage'

interface Parada {
  id: string
  orden: number
  estado: string
  km_parada: number | null
  combustible_parada: number | null
  litros_cargados: number | null
  precio_litro: number | null
  foto_parada_path: string | null
  centros_costo: { nombre: string } | null
}

interface RecorridoHistorico {
  id: string
  vehiculo_codigo: string
  estado: string
  usa_paradas: boolean
  fecha_salida: string
  fecha_regreso: string | null
  km_salida: number
  km_regreso: number | null
  combustible_salida: number
  combustible_regreso: number | null
  litros_cargados: number | null
  precio_litro: number | null
  foto_salida_path: string | null
  foto_regreso_path: string | null
  conductores: { nombre: string } | null
  centros_costo: { nombre: string } | null
  vehiculos: { capacidad_tanque_litros: number } | null
  recorridos_paradas: Parada[]
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
  const [fotoModal, setFotoModal] = useState<{ url: string; titulo: string } | null>(null)
  const [paradasModal, setParadasModal] = useState<RecorridoHistorico | null>(null)

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
          id, vehiculo_codigo, estado, usa_paradas, fecha_salida, fecha_regreso,
          km_salida, km_regreso, combustible_salida, combustible_regreso,
          litros_cargados, precio_litro, foto_salida_path, foto_regreso_path,
          conductores(nombre),
          centros_costo(nombre),
          vehiculos(capacidad_tanque_litros),
          recorridos_paradas(id, orden, estado, km_parada, combustible_parada, litros_cargados, precio_litro, foto_parada_path, centros_costo(nombre))
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

      {/* Modal de foto */}
      {fotoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setFotoModal(null)}
        >
          {/* Fondo difuminado */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          {/* Contenedor foto */}
          <div
            className="relative z-10 max-w-2xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white rounded-2xl overflow-hidden shadow-2xl">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <span className="text-sm font-semibold text-gray-700">{fotoModal.titulo}</span>
                <button
                  onClick={() => setFotoModal(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-lg font-bold"
                >
                  ✕
                </button>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fotoModal.url}
                alt={fotoModal.titulo}
                className="w-full object-contain max-h-[75vh]"
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal de paradas */}
      {paradasModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setParadasModal(null)}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            className="relative z-10 w-full max-w-lg max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
                <div>
                  <p className="text-sm font-bold text-gray-800">
                    {paradasModal.vehiculo_codigo} — Paradas del recorrido
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatFecha(paradasModal.fecha_salida)}</p>
                </div>
                <button
                  onClick={() => setParadasModal(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-lg font-bold"
                >
                  ✕
                </button>
              </div>

              {/* Lista de paradas */}
              <div className="overflow-y-auto divide-y divide-gray-100">
                {[...paradasModal.recorridos_paradas]
                  .sort((a, b) => a.orden - b.orden)
                  .map((p) => (
                    <div key={p.id} className="px-4 py-4 space-y-2">
                      {/* Encabezado parada */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
                            {p.orden}
                          </span>
                          <span className="text-sm font-semibold text-gray-800">
                            {p.centros_costo?.nombre ?? 'Centro de costo no registrado'}
                          </span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          p.estado === 'completada'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {p.estado === 'completada' ? 'Completada' : 'Pendiente'}
                        </span>
                      </div>

                      {/* Datos de la parada */}
                      {p.estado === 'completada' && (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs pl-8">
                          {p.km_parada != null && (
                            <div>
                              <span className="text-gray-400">KM parada</span>
                              <span className="ml-1 font-medium text-gray-700">{p.km_parada.toLocaleString()}</span>
                            </div>
                          )}
                          {p.combustible_parada != null && (
                            <div>
                              <span className="text-gray-400">Combustible</span>
                              <span className="ml-1 font-medium text-gray-700">{combustibleLabel(p.combustible_parada)}</span>
                            </div>
                          )}
                          {p.litros_cargados != null && p.litros_cargados > 0 && (
                            <div>
                              <span className="text-gray-400">Litros cargados</span>
                              <span className="ml-1 font-medium text-gray-700">{formatDecimal(p.litros_cargados)} L</span>
                            </div>
                          )}
                          {p.litros_cargados && p.precio_litro ? (
                            <div>
                              <span className="text-gray-400">Costo recarga</span>
                              <span className="ml-1 font-medium text-gray-700">{formatMoneda(calcImporte(p.litros_cargados, p.precio_litro))}</span>
                            </div>
                          ) : null}
                        </div>
                      )}

                      {/* Foto de la parada */}
                      {p.foto_parada_path && (
                        <div className="pl-8">
                          <button
                            onClick={() => {
                              setParadasModal(null)
                              setFotoModal({
                                url: getPublicUrl(p.foto_parada_path!),
                                titulo: `Foto parada ${p.orden} — ${paradasModal.vehiculo_codigo}`,
                              })
                            }}
                            className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            Ver foto de parada
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>

              {/* Footer con totales de paradas */}
              {paradasModal.recorridos_paradas.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 shrink-0">
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>
                      <span className="font-semibold text-gray-700">
                        {paradasModal.recorridos_paradas.filter(p => p.estado === 'completada').length}
                      </span>
                      /{paradasModal.recorridos_paradas.length} completadas
                    </span>
                    {(() => {
                      const totalLitros = paradasModal.recorridos_paradas.reduce(
                        (acc, p) => acc + (p.litros_cargados ?? 0), 0
                      )
                      const totalCostoParadas = paradasModal.recorridos_paradas.reduce(
                        (acc, p) => acc + (p.litros_cargados && p.precio_litro ? calcImporte(p.litros_cargados, p.precio_litro) : 0), 0
                      )
                      return totalLitros > 0 ? (
                        <>
                          <span>Total recargado: <span className="font-semibold text-gray-700">{formatDecimal(totalLitros)} L</span></span>
                          {totalCostoParadas > 0 && (
                            <span>Costo: <span className="font-semibold text-gray-700">{formatMoneda(totalCostoParadas)}</span></span>
                          )}
                        </>
                      ) : null
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
                  <th className="px-3 py-3 text-center whitespace-nowrap">Paradas</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">Foto sal.</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">Foto reg.</th>
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
                        {r.usa_paradas && r.recorridos_paradas.length > 0 ? (
                          <button
                            onClick={() => setParadasModal(r)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-semibold transition-colors"
                            title="Ver paradas"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {r.recorridos_paradas.length}
                          </button>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {r.foto_salida_path ? (
                          <button
                            onClick={() => setFotoModal({
                              url: getPublicUrl(r.foto_salida_path!),
                              titulo: `Foto salida — ${r.vehiculo_codigo} · ${formatFecha(r.fecha_salida)}`,
                            })}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors"
                            title="Ver foto de salida"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </button>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {r.foto_regreso_path ? (
                          <button
                            onClick={() => setFotoModal({
                              url: getPublicUrl(r.foto_regreso_path!),
                              titulo: `Foto regreso — ${r.vehiculo_codigo} · ${r.fecha_regreso ? formatFecha(r.fecha_regreso) : ''}`,
                            })}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-green-50 hover:bg-green-100 text-green-600 transition-colors"
                            title="Ver foto de regreso"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </button>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
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
