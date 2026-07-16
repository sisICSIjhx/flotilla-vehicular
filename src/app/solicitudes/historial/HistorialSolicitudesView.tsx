'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type SolicitudCombustibleAuditoriaConDetalle } from '@/lib/supabase'
import {
  HISTORIAL_SOLICITUD_TIPOS,
  historialSolicitudTipoLabel,
  CAMPOS_EDITABLES_SOLICITUD_LABEL,
} from '@/lib/constants'
import { formatFecha, formatMoneda } from '@/utils/formatters'
import ErrorMessage from '@/components/common/ErrorMessage'
import Loading from '@/components/common/Loading'

type FiltroTipo = 'todos' | 'edicion_admin' | 'eliminacion_admin'

const TABS: { value: FiltroTipo; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'edicion_admin', label: 'Editados' },
  { value: 'eliminacion_admin', label: 'Eliminados' },
]

function formatValor(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  if (campo === 'monto_autorizado') return formatMoneda(Number(valor))
  return String(valor)
}

export default function HistorialSolicitudesView() {
  const router = useRouter()

  const [registros, setRegistros] = useState<SolicitudCombustibleAuditoriaConDetalle[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos')
  const [filtroVehiculo, setFiltroVehiculo] = useState('')
  const [filtroOperador, setFiltroOperador] = useState('')
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')

  const cargarHistorial = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('solicitudes_combustible_auditoria') as any)
        .select(
          '*, solicitudes_combustible(folio, vehiculo_codigo, estado, monto_solicitado, monto_autorizado, vehiculos(apodo, placa), conductores(nombre), centros_costo(nombre))'
        )
        .in('accion', ['edicion_admin', 'eliminacion_admin'])
        .order('created_at', { ascending: false })
        .limit(500)

      if (error) throw new Error(error.message)
      setRegistros((data ?? []) as SolicitudCombustibleAuditoriaConDetalle[])
    } catch (err) {
      setError(
        err instanceof Error
          ? `Error al cargar el historial: ${err.message}`
          : 'Error al cargar el historial.'
      )
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargarHistorial()
  }, [cargarHistorial])

  const filtrados = useMemo(() => {
    return registros.filter((r) => {
      if (filtroTipo !== 'todos' && r.accion !== filtroTipo) return false
      if (filtroVehiculo && r.solicitudes_combustible?.vehiculo_codigo !== filtroVehiculo) return false
      if (filtroOperador && r.solicitudes_combustible?.conductores?.nombre !== filtroOperador) return false
      if (filtroDesde && r.created_at < `${filtroDesde}T00:00:00`) return false
      if (filtroHasta && r.created_at > `${filtroHasta}T23:59:59`) return false
      return true
    })
  }, [registros, filtroTipo, filtroVehiculo, filtroOperador, filtroDesde, filtroHasta])

  const vehiculosUnicos = useMemo(() => {
    const porCodigo = new Map<string, string>()
    for (const r of registros) {
      const codigo = r.solicitudes_combustible?.vehiculo_codigo
      if (codigo && !porCodigo.has(codigo)) {
        porCodigo.set(codigo, r.solicitudes_combustible?.vehiculos?.apodo ?? '')
      }
    }
    return [...porCodigo.entries()]
      .map(([codigo, apodo]) => ({ codigo, apodo }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo))
  }, [registros])

  const operadoresUnicos = useMemo(
    () =>
      [...new Set(registros.map((r) => r.solicitudes_combustible?.conductores?.nombre).filter(Boolean))].sort(),
    [registros]
  )

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando historial..." />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-orange-600 text-white px-4 py-5 shadow flex items-center gap-3">
        <button
          onClick={() => router.push('/solicitudes')}
          className="text-orange-200 hover:text-white transition-colors"
          aria-label="Volver a Solicitudes"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold">Historial de cambios</h1>
          <p className="text-orange-200 text-sm">Ediciones y eliminaciones administrativas de solicitudes</p>
        </div>
      </header>

      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">
        {error && <ErrorMessage mensaje={error} />}

        {/* ── Filtros ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
          <div className="flex gap-1.5 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setFiltroTipo(t.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filtroTipo === t.value
                    ? 'bg-orange-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500">Unidad</label>
              <select
                value={filtroVehiculo}
                onChange={(e) => setFiltroVehiculo(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="">Todas</option>
                {vehiculosUnicos.map((v) => (
                  <option key={v.codigo} value={v.codigo}>
                    {v.apodo ? `${v.codigo} · ${v.apodo}` : v.codigo}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500">Operador</label>
              <select
                value={filtroOperador}
                onChange={(e) => setFiltroOperador(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="">Todos</option>
                {operadoresUnicos.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500">Desde</label>
              <input
                type="date"
                value={filtroDesde}
                onChange={(e) => setFiltroDesde(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500">Hasta</label>
              <input
                type="date"
                value={filtroHasta}
                onChange={(e) => setFiltroHasta(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>
        </div>

        {/* ── Lista ── */}
        {filtrados.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center space-y-2">
            <span className="text-4xl">🕒</span>
            <p className="text-gray-500 text-sm">No hay cambios con los filtros actuales.</p>
          </div>
        ) : (
          filtrados.map((r) => {
            const sol = r.solicitudes_combustible
            const tipo = HISTORIAL_SOLICITUD_TIPOS[r.accion]
            const metadata = (r.metadata ?? {}) as Record<string, unknown>

            return (
              <div
                key={r.id}
                className={`rounded-2xl shadow-sm border p-4 space-y-3 ${tipo?.rowBg ?? 'bg-white border-gray-100'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono font-bold text-gray-800">{sol?.folio ?? '—'}</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${tipo?.badge ?? ''}`}>
                    {historialSolicitudTipoLabel(r.accion)}
                  </span>
                </div>

                <p className="text-sm text-gray-700">
                  <strong>{sol?.vehiculo_codigo ?? 'N/A'}</strong>
                  {sol?.vehiculos?.apodo ? ` · ${sol.vehiculos.apodo}` : ''}
                  {sol?.vehiculos?.placa ? ` · ${sol.vehiculos.placa}` : ''}
                  {' · '}
                  {sol?.conductores?.nombre ?? 'N/A'}
                </p>

                <p className="text-xs text-gray-500">
                  {formatFecha(r.created_at)} · Realizado por {r.usuario ?? 'N/A'}
                </p>

                {r.comentario && (
                  <p className="text-sm bg-white/70 rounded-xl border border-gray-200 px-3 py-2">
                    <span className="text-xs text-gray-500 block">Motivo</span>
                    {r.comentario}
                  </p>
                )}

                {r.accion === 'edicion_admin' && (
                  <div className="bg-white/70 rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-gray-500">
                          <th className="text-left px-3 py-1.5 font-medium">Campo</th>
                          <th className="text-left px-3 py-1.5 font-medium">Antes</th>
                          <th className="text-left px-3 py-1.5 font-medium">Ahora</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys((metadata.despues as Record<string, unknown>) ?? {}).map((campo) => (
                          <tr key={campo} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 text-gray-600">
                              {CAMPOS_EDITABLES_SOLICITUD_LABEL[campo] ?? campo}
                            </td>
                            <td className="px-3 py-1.5 text-red-600">
                              {formatValor(campo, (metadata.antes as Record<string, unknown>)?.[campo])}
                            </td>
                            <td className="px-3 py-1.5 text-green-700 font-medium">
                              {formatValor(campo, (metadata.despues as Record<string, unknown>)?.[campo])}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {r.accion === 'eliminacion_admin' && (
                  <div className="grid grid-cols-2 gap-2 text-sm bg-white/70 rounded-xl border border-gray-200 px-3 py-2">
                    <div>
                      <p className="text-xs text-gray-500">Estado al eliminar</p>
                      <p className="font-semibold">{String(metadata.estado_al_eliminar ?? sol?.estado ?? '—')}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Monto solicitado</p>
                      <p className="font-semibold">
                        {formatMoneda(Number(metadata.monto_solicitado ?? sol?.monto_solicitado ?? 0))}
                      </p>
                    </div>
                    {(metadata.monto_autorizado ?? sol?.monto_autorizado) != null && (
                      <div>
                        <p className="text-xs text-gray-500">Monto autorizado</p>
                        <p className="font-semibold">
                          {formatMoneda(Number(metadata.monto_autorizado ?? sol?.monto_autorizado))}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
        <div className="pb-8" />
      </main>
    </div>
  )
}
