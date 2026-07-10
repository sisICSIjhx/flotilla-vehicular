'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { combustibleLabel } from '@/lib/constants'
import { formatFecha, formatMoneda, formatDecimal } from '@/utils/formatters'
import Loading from '@/components/common/Loading'

interface CargaRow {
  id: string
  vehiculo_codigo: string
  placa: string | null
  apodo: string | null
  conductor: string
  km_antes: number
  combustible_antes: number
  combustible_despues: number
  litros_cargados: number
  precio_litro: number
  costo_total: number
  foto_ticket_path: string | null
  fecha_carga: string
  recorrido_id: string | null
}

export default function CargasGasolinaAdminView() {
  const [cargas, setCargas] = useState<CargaRow[]>([])
  const [vehiculos, setVehiculos] = useState<{ codigo: string; apodo: string | null; placa: string | null }[]>([])
  const [filtroVehiculo, setFiltroVehiculo] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const [confirmandoId, setConfirmandoId] = useState<string | null>(null)
  const [eliminando, setEliminando] = useState(false)
  const [mensajeExito, setMensajeExito] = useState('')

  const cargarDatos = useCallback(async () => {
    setCargando(true)
    setError('')

    try {
      const [{ data: vehs }, { data: rawCargas, error: errCargas }] = await Promise.all([
        supabase
          .from('vehiculos')
          .select('codigo, apodo, placa')
          .order('codigo'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('cargas_gasolina') as any)
          .select(`
            id,
            vehiculo_codigo,
            km_antes,
            combustible_antes,
            combustible_despues,
            litros_cargados,
            precio_litro,
            foto_ticket_path,
            created_at,
            recorrido_id,
            conductores!conductor_id ( nombre ),
            vehiculos!vehiculo_codigo ( placa, apodo )
          `)
          .order('created_at', { ascending: false }),
      ])

      if (errCargas) throw new Error(errCargas.message)

      setVehiculos(vehs ?? [])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: CargaRow[] = (rawCargas ?? []).map((r: any) => ({
        id: r.id,
        vehiculo_codigo: r.vehiculo_codigo,
        placa: r.vehiculos?.placa ?? null,
        apodo: r.vehiculos?.apodo ?? null,
        conductor: r.conductores?.nombre ?? '—',
        km_antes: r.km_antes,
        combustible_antes: r.combustible_antes,
        combustible_despues: r.combustible_despues,
        litros_cargados: r.litros_cargados,
        precio_litro: r.precio_litro,
        costo_total: r.litros_cargados * r.precio_litro,
        foto_ticket_path: r.foto_ticket_path,
        fecha_carga: r.created_at,
        recorrido_id: r.recorrido_id,
      }))

      setCargas(mapped)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  async function eliminarCarga(id: string) {
    setEliminando(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: errDel } = await (supabase.from('cargas_gasolina') as any)
        .delete()
        .eq('id', id)

      if (errDel) throw new Error(errDel.message)

      setCargas(prev => prev.filter(c => c.id !== id))
      setMensajeExito('Carga eliminada correctamente.')
      setTimeout(() => setMensajeExito(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setEliminando(false)
      setConfirmandoId(null)
    }
  }

  const cargasFiltradas = filtroVehiculo
    ? cargas.filter(c => c.vehiculo_codigo === filtroVehiculo)
    : cargas

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando cargas de gasolina..." />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white px-4 py-5 shadow flex items-center gap-3">
        <Link
          href="/gasolina"
          className="text-green-200 hover:text-white transition-colors"
          aria-label="Volver a Gasolina"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">Admin — Cargas de Gasolina</h1>
          <p className="text-green-200 text-sm mt-0.5">{cargas.length} registros en total</p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}
        {mensajeExito && (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm font-medium">
            {mensajeExito}
          </div>
        )}

        {/* Filtro */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Filtrar por vehículo</label>
          <select
            value={filtroVehiculo}
            onChange={e => setFiltroVehiculo(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="">Todos los vehículos ({cargas.length})</option>
            {vehiculos.map(v => {
              const count = cargas.filter(c => c.vehiculo_codigo === v.codigo).length
              if (count === 0) return null
              const label = [v.codigo, v.apodo, v.placa].filter(Boolean).join(' · ')
              return (
                <option key={v.codigo} value={v.codigo}>
                  {label} ({count})
                </option>
              )
            })}
          </select>
        </div>

        {/* Lista */}
        <div className="space-y-3">
          {cargasFiltradas.length === 0 && (
            <div className="text-center py-12 text-gray-400">Sin registros</div>
          )}

          {cargasFiltradas.map((carga, idx) => {
            const esPrimero = idx === 0
            return (
              <div
                key={carga.id}
                className={`bg-white rounded-2xl border shadow-sm p-4 space-y-3 ${esPrimero ? 'border-green-300 ring-1 ring-green-200' : 'border-gray-200'}`}
              >
                {esPrimero && (
                  <span className="inline-block bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                    Más reciente
                  </span>
                )}

                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm">
                      {carga.vehiculo_codigo}
                      {carga.apodo && <span className="font-normal text-gray-500"> · {carga.apodo}</span>}
                      {carga.placa && <span className="font-normal text-gray-500"> · {carga.placa}</span>}
                    </p>
                    <p className="text-xs text-gray-500">{carga.conductor}</p>
                    <p className="text-xs text-gray-400">{formatFecha(carga.fecha_carga)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-bold text-green-700">{formatMoneda(carga.costo_total)}</p>
                    <p className="text-xs text-gray-500">{formatDecimal(carga.litros_cargados)} L</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 bg-gray-50 rounded-xl px-3 py-2">
                  <span>KM odómetro: <strong>{carga.km_antes.toLocaleString()}</strong></span>
                  <span>Precio/L: <strong>{formatMoneda(carga.precio_litro)}</strong></span>
                  <span>Antes: <strong>{combustibleLabel(carga.combustible_antes)}</strong></span>
                  <span>Después: <strong>{combustibleLabel(carga.combustible_despues)}</strong></span>
                </div>

                {carga.recorrido_id && (
                  <p className="text-xs text-blue-600">Asociada a recorrido</p>
                )}

                {confirmandoId === carga.id ? (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                    <p className="text-sm font-semibold text-red-700">¿Confirmar eliminación?</p>
                    <p className="text-xs text-red-600">
                      Se eliminará la carga de {formatDecimal(carga.litros_cargados)} L registrada el {formatFecha(carga.fecha_carga)}.
                      Esta acción no se puede deshacer.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => eliminarCarga(carga.id)}
                        disabled={eliminando}
                        className="flex-1 bg-red-600 text-white text-sm font-semibold py-2 rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
                      </button>
                      <button
                        onClick={() => setConfirmandoId(null)}
                        disabled={eliminando}
                        className="flex-1 bg-gray-200 text-gray-700 text-sm font-semibold py-2 rounded-xl hover:bg-gray-300 disabled:opacity-50 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmandoId(carga.id)}
                    className="w-full text-sm text-red-600 font-medium border border-red-200 rounded-xl py-2 hover:bg-red-50 transition-colors"
                  >
                    Eliminar esta carga
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
