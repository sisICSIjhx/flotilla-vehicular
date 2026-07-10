'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  supabase,
  type SolicitudCombustibleConDetalle,
  type SolicitudCombustibleAuditoria,
} from '@/lib/supabase'
import {
  SOLICITUD_ESTADOS,
  solicitudEstadoLabel,
  tipoCargaLabel,
  combustibleLabel,
} from '@/lib/constants'
import { formatFecha, formatMoneda } from '@/utils/formatters'
import { comprimirFoto } from '@/lib/imageCompression'
import { buildEvidenciaEdenredPath, subirEvidenciaEdenred } from '@/utils/storage'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import PhotoCapture from '@/components/forms/PhotoCapture'
import ErrorMessage from '@/components/common/ErrorMessage'
import Loading from '@/components/common/Loading'

const RESPONSABLE_KEY = 'solicitudes_responsable_nombre'

type FiltroEstado = 'todas' | 'pendiente' | 'autorizada' | 'rechazada' | 'cancelada' | 'cargada_edenred'

const TABS: { value: FiltroEstado; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'autorizada', label: 'Autorizadas' },
  { value: 'rechazada', label: 'Rechazadas' },
  { value: 'cargada_edenred', label: 'Cargadas' },
  { value: 'cancelada', label: 'Canceladas' },
]

export default function SolicitudesView() {
  const router = useRouter()

  const [solicitudes, setSolicitudes] = useState<SolicitudCombustibleConDetalle[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [noLeidas, setNoLeidas] = useState(0)

  // ── Filtros ──
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todas')
  const [filtroVehiculo, setFiltroVehiculo] = useState('')
  const [filtroOperador, setFiltroOperador] = useState('')
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')

  // ── Detalle expandido ──
  const [expandida, setExpandida] = useState<string | null>(null)
  const [auditoria, setAuditoria] = useState<SolicitudCombustibleAuditoria[]>([])

  // ── Acciones ──
  const [responsable, setResponsable] = useState('')
  const [montoAutorizar, setMontoAutorizar] = useState('')
  const [motivoRechazo, setMotivoRechazo] = useState('')
  const [montoCargado, setMontoCargado] = useState('')
  const [evidencia, setEvidencia] = useState<File | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  useEffect(() => {
    setResponsable(sessionStorage.getItem(RESPONSABLE_KEY) ?? '')
  }, [])

  const cargarSolicitudes = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('solicitudes_combustible') as any)
        .select('*, conductores(id, nombre), centros_costo(id, nombre, codigo), vehiculos(codigo, apodo, placa)')
        .order('created_at', { ascending: false })
        .limit(500)

      if (error) throw new Error(error.message)
      setSolicitudes((data ?? []) as SolicitudCombustibleConDetalle[])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await (supabase.from('notificaciones') as any)
        .select('id', { count: 'exact', head: true })
        .eq('destinatario', 'admin')
        .eq('leida', false)
      setNoLeidas(count ?? 0)
    } catch (err) {
      setErrorGeneral(
        err instanceof Error
          ? `Error al cargar solicitudes: ${err.message}`
          : 'Error al cargar solicitudes.'
      )
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargarSolicitudes()
  }, [cargarSolicitudes])

  // Realtime: refrescar campanita y lista cuando llega una
  // notificación de admin (requiere supabase_notificaciones_push.sql)
  useEffect(() => {
    const channel = supabase
      .channel('notificaciones-admin')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notificaciones',
          filter: 'destinatario=eq.admin',
        },
        () => {
          cargarSolicitudes()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [cargarSolicitudes])

  async function marcarNotificacionesLeidas() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('notificaciones') as any)
        .update({ leida: true })
        .eq('destinatario', 'admin')
        .eq('leida', false)
      setNoLeidas(0)
    } catch {
      // ignorar
    }
  }

  async function toggleDetalle(sol: SolicitudCombustibleConDetalle) {
    setErrorAccion(null)
    if (expandida === sol.id) {
      setExpandida(null)
      return
    }
    setExpandida(sol.id)
    setMontoAutorizar(String(sol.monto_solicitado))
    setMontoCargado(String(sol.monto_autorizado ?? sol.monto_solicitado))
    setMotivoRechazo('')
    setEvidencia(null)
    setAuditoria([])

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('solicitudes_combustible_auditoria') as any)
        .select('*')
        .eq('solicitud_id', sol.id)
        .order('created_at', { ascending: true })
      setAuditoria((data ?? []) as SolicitudCombustibleAuditoria[])
    } catch {
      // auditoría opcional en UI
    }
  }

  function validarResponsable(): boolean {
    if (!responsable.trim()) {
      setErrorAccion('Escribe el nombre del responsable antes de ejecutar la acción.')
      return false
    }
    sessionStorage.setItem(RESPONSABLE_KEY, responsable.trim())
    return true
  }

  async function ejecutarRpc(accion: string, rpc: string, params: Record<string, unknown>) {
    setProcesando(accion)
    setErrorAccion(null)
    try {
      const { error } = await supabase.rpc(rpc, params)
      if (error) throw new Error(error.message)
      setExpandida(null)
      await cargarSolicitudes()
    } catch (err) {
      setErrorAccion(err instanceof Error ? err.message : 'Error al ejecutar la acción.')
    } finally {
      setProcesando(null)
    }
  }

  async function handleAutorizar(sol: SolicitudCombustibleConDetalle) {
    if (!validarResponsable()) return
    if (!montoAutorizar || Number(montoAutorizar) <= 0) {
      setErrorAccion('El monto autorizado debe ser mayor a 0.')
      return
    }
    await ejecutarRpc('autorizar', 'autorizar_solicitud_combustible', {
      p_solicitud_id: sol.id,
      p_usuario: responsable.trim(),
      p_monto_autorizado: Number(montoAutorizar),
    })
  }

  async function handleRechazar(sol: SolicitudCombustibleConDetalle) {
    if (!validarResponsable()) return
    if (!motivoRechazo.trim()) {
      setErrorAccion('El motivo de rechazo es obligatorio.')
      return
    }
    await ejecutarRpc('rechazar', 'rechazar_solicitud_combustible', {
      p_solicitud_id: sol.id,
      p_usuario: responsable.trim(),
      p_motivo: motivoRechazo.trim(),
    })
  }

  async function handleCancelar(sol: SolicitudCombustibleConDetalle) {
    if (!validarResponsable()) return
    await ejecutarRpc('cancelar', 'cancelar_solicitud_combustible', {
      p_solicitud_id: sol.id,
      p_usuario: responsable.trim(),
      p_motivo: motivoRechazo.trim() || null,
    })
  }

  async function handleCargaEdenred(sol: SolicitudCombustibleConDetalle) {
    if (!validarResponsable()) return
    if (!montoCargado || Number(montoCargado) <= 0) {
      setErrorAccion('El monto cargado debe ser mayor a 0.')
      return
    }

    setProcesando('edenred')
    setErrorAccion(null)
    try {
      // Evidencia opcional: solo se sube si se adjuntó foto
      let url: string | null = null
      if (evidencia) {
        const comprimida = await comprimirFoto(evidencia)
        const path = buildEvidenciaEdenredPath(sol.id)
        url = await subirEvidenciaEdenred(path, comprimida)
      }

      const { error } = await supabase.rpc('registrar_carga_edenred', {
        p_solicitud_id: sol.id,
        p_usuario: responsable.trim(),
        p_monto_cargado: Number(montoCargado),
        p_evidencia_path: url,
      })
      if (error) throw new Error(error.message)
      setExpandida(null)
      await cargarSolicitudes()
    } catch (err) {
      setErrorAccion(err instanceof Error ? err.message : 'Error al registrar la carga.')
    } finally {
      setProcesando(null)
    }
  }

  // ── Aplicar filtros ──
  const filtradas = useMemo(() => {
    return solicitudes.filter((s) => {
      if (filtroEstado !== 'todas' && s.estado !== filtroEstado) return false
      if (filtroVehiculo && s.vehiculo_codigo !== filtroVehiculo) return false
      if (filtroOperador && s.conductores?.nombre !== filtroOperador) return false
      if (filtroDesde && s.created_at < `${filtroDesde}T00:00:00`) return false
      if (filtroHasta && s.created_at > `${filtroHasta}T23:59:59`) return false
      return true
    })
  }, [solicitudes, filtroEstado, filtroVehiculo, filtroOperador, filtroDesde, filtroHasta])

  const vehiculosUnicos = useMemo(() => {
    const porCodigo = new Map<string, string>()
    for (const s of solicitudes) {
      if (!porCodigo.has(s.vehiculo_codigo)) {
        porCodigo.set(s.vehiculo_codigo, s.vehiculos?.apodo ?? '')
      }
    }
    return [...porCodigo.entries()]
      .map(([codigo, apodo]) => ({ codigo, apodo }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo))
  }, [solicitudes])
  const operadoresUnicos = useMemo(
    () => [...new Set(solicitudes.map((s) => s.conductores?.nombre).filter(Boolean))].sort(),
    [solicitudes]
  )

  const totalSolicitado = filtradas.reduce((acc, s) => acc + Number(s.monto_solicitado), 0)
  const totalAutorizado = filtradas.reduce((acc, s) => acc + Number(s.monto_autorizado ?? 0), 0)
  const pendientes = solicitudes.filter((s) => s.estado === 'pendiente').length

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando solicitudes..." />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-orange-600 text-white px-4 py-5 shadow flex items-center gap-3">
        <button
          onClick={() => router.push('/gasolina')}
          className="text-orange-200 hover:text-white transition-colors"
          aria-label="Volver a Gasolina"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Solicitudes de Combustible</h1>
            <p className="text-orange-200 text-sm">
              {pendientes} pendiente{pendientes === 1 ? '' : 's'} de autorización
            </p>
          </div>
          {noLeidas > 0 && (
            <button
              onClick={marcarNotificacionesLeidas}
              className="relative bg-orange-700 hover:bg-orange-800 rounded-xl px-3 py-2 text-sm"
              title="Marcar notificaciones como leídas"
            >
              🔔
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {noLeidas > 9 ? '9+' : noLeidas}
              </span>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">
        {errorGeneral && <ErrorMessage mensaje={errorGeneral} />}

        {/* ── Responsable ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <Input
            label="Nombre del responsable (para autorizar / rechazar / cargar)"
            type="text"
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            placeholder="Ej: Juan Pérez"
          />
        </div>

        {/* ── Totales ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">Monto total solicitado</p>
            <p className="text-lg font-bold text-gray-800">{formatMoneda(totalSolicitado)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">Monto total autorizado</p>
            <p className="text-lg font-bold text-green-700">{formatMoneda(totalAutorizado)}</p>
          </div>
        </div>

        {/* ── Filtros ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
          <div className="flex gap-1.5 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setFiltroEstado(t.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filtroEstado === t.value
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
        {filtradas.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center space-y-2">
            <span className="text-4xl">⛽</span>
            <p className="text-gray-500 text-sm">No hay solicitudes con los filtros actuales.</p>
          </div>
        ) : (
          filtradas.map((sol) => (
            <div key={sol.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <button
                onClick={() => toggleDetalle(sol)}
                className="w-full text-left p-4 space-y-2 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono font-bold text-gray-800">{sol.folio ?? '—'}</p>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                      SOLICITUD_ESTADOS[sol.estado]?.badge ?? ''
                    }`}
                  >
                    {solicitudEstadoLabel(sol.estado)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <p className="text-gray-700">
                    <strong>{sol.vehiculo_codigo}</strong>
                    {sol.vehiculos?.apodo ? ` · ${sol.vehiculos.apodo}` : ''}
                    {sol.vehiculos?.placa ? ` · ${sol.vehiculos.placa}` : ''}
                  </p>
                  <p className="font-semibold text-gray-800">{formatMoneda(Number(sol.monto_solicitado))}</p>
                </div>
                <p className="text-xs text-gray-500">
                  {formatFecha(sol.created_at)} · {sol.conductores?.nombre ?? 'N/A'} ·{' '}
                  {sol.centros_costo?.nombre ?? 'N/A'} · {tipoCargaLabel(sol.tipo_carga)}
                  {sol.emergencia && <span className="text-red-600 font-semibold"> · EMERGENCIA</span>}
                  {!sol.emergencia && sol.fuera_horario && <span className="text-amber-600"> · Fuera de horario</span>}
                </p>
              </button>

              {expandida === sol.id && (
                <div className="border-t border-gray-100 p-4 space-y-4 bg-gray-50/60">
                  {/* ── Detalle ── */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><p className="text-xs text-gray-500">Kilometraje</p><p className="font-semibold">{sol.km_solicitud.toLocaleString()} km</p></div>
                    <div><p className="text-xs text-gray-500">Nivel</p><p className="font-semibold">{combustibleLabel(sol.combustible_nivel)}</p></div>
                    <div><p className="text-xs text-gray-500">Destino</p><p className="font-semibold">{sol.destino ?? 'N/A'}</p></div>
                    <div><p className="text-xs text-gray-500">Monto sugerido</p><p className="font-semibold">{sol.monto_sugerido != null ? formatMoneda(Number(sol.monto_sugerido)) : '—'}</p></div>
                    {sol.monto_autorizado != null && (
                      <div><p className="text-xs text-gray-500">Monto autorizado</p><p className="font-semibold text-green-700">{formatMoneda(Number(sol.monto_autorizado))}</p></div>
                    )}
                    {sol.autorizado_por && (
                      <div><p className="text-xs text-gray-500">Resuelto por</p><p className="font-semibold">{sol.autorizado_por}</p></div>
                    )}
                    {sol.fecha_carga_edenred && (
                      <div><p className="text-xs text-gray-500">Carga Edenred</p><p className="font-semibold">{formatFecha(sol.fecha_carga_edenred)} · {sol.cargado_por}</p></div>
                    )}
                  </div>
                  {sol.observaciones && (
                    <p className="text-sm text-gray-600 bg-white rounded-xl border border-gray-200 px-3 py-2">
                      <span className="text-xs text-gray-400 block">Observaciones</span>
                      {sol.observaciones}
                    </p>
                  )}
                  {sol.motivo_rechazo && (
                    <p className="text-sm text-red-700 bg-red-50 rounded-xl border border-red-200 px-3 py-2">
                      <span className="text-xs text-red-400 block">Motivo de rechazo</span>
                      {sol.motivo_rechazo}
                    </p>
                  )}
                  {sol.edenred_evidencia_path && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Evidencia Edenred</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={sol.edenred_evidencia_path}
                        alt="Evidencia Edenred"
                        className="w-full rounded-xl border border-gray-200 max-h-52 object-cover"
                      />
                    </div>
                  )}

                  {errorAccion && <ErrorMessage mensaje={errorAccion} />}

                  {/* ── Acciones para pendiente ── */}
                  {sol.estado === 'pendiente' && (
                    <div className="space-y-3">
                      <Input
                        label="Monto autorizado ($)"
                        type="number"
                        min={0}
                        step="0.01"
                        value={montoAutorizar}
                        onChange={(e) => setMontoAutorizar(e.target.value)}
                        inputMode="decimal"
                      />
                      <Button
                        onClick={() => handleAutorizar(sol)}
                        loading={procesando === 'autorizar'}
                        disabled={procesando !== null}
                      >
                        Autorizar
                      </Button>
                      <Input
                        label="Motivo de rechazo"
                        type="text"
                        value={motivoRechazo}
                        onChange={(e) => setMotivoRechazo(e.target.value)}
                        placeholder="Obligatorio para rechazar"
                      />
                      <div className="flex gap-3">
                        <Button
                          variant="danger"
                          onClick={() => handleRechazar(sol)}
                          loading={procesando === 'rechazar'}
                          disabled={procesando !== null}
                        >
                          Rechazar
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => handleCancelar(sol)}
                          loading={procesando === 'cancelar'}
                          disabled={procesando !== null}
                        >
                          Cancelar solicitud
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* ── Acciones para autorizada ── */}
                  {sol.estado === 'autorizada' && (
                    <div className="space-y-3">
                      <Input
                        label="Monto cargado en Edenred ($)"
                        type="number"
                        min={0}
                        step="0.01"
                        value={montoCargado}
                        onChange={(e) => setMontoCargado(e.target.value)}
                        inputMode="decimal"
                      />
                      <PhotoCapture
                        label="Evidencia de la carga Edenred (opcional)"
                        onPhoto={setEvidencia}
                      />
                      <Button
                        onClick={() => handleCargaEdenred(sol)}
                        loading={procesando === 'edenred'}
                        disabled={procesando !== null}
                        className="!bg-green-600 hover:!bg-green-700 active:!bg-green-800"
                      >
                        Marcar como cargada en Edenred
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => handleCancelar(sol)}
                        loading={procesando === 'cancelar'}
                        disabled={procesando !== null}
                      >
                        Cancelar solicitud
                      </Button>
                    </div>
                  )}

                  {/* ── Auditoría ── */}
                  {auditoria.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-gray-500 uppercase">Historial</p>
                      {auditoria.map((a) => (
                        <div key={a.id} className="text-xs text-gray-600 bg-white rounded-lg border border-gray-200 px-3 py-2">
                          <span className="font-semibold">{formatFecha(a.created_at)}</span>
                          {' — '}
                          {a.accion}
                          {a.estado_anterior ? ` (${a.estado_anterior} → ${a.estado_nuevo})` : ''}
                          {a.usuario ? ` · ${a.usuario}` : ''}
                          {a.comentario ? ` · ${a.comentario}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        <div className="pb-8" />
      </main>
    </div>
  )
}
