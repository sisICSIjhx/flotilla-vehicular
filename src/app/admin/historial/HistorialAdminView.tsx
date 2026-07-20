'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Historial unificado de cambios administrativos: concentra en una
// sola pantalla las bitácoras de mantenimientos/refacciones/gastos
// (auditoria_admin), solicitudes de combustible
// (solicitudes_combustible_auditoria) y recorridos
// (recorridos_auditoria), con filtros por módulo, unidad, acción
// y rango de fechas.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Vehiculo } from '@/lib/supabase'
import Loading from '@/components/common/Loading'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import { formatFecha } from '@/utils/formatters'

interface EventoHistorial {
  id: string
  fecha: string
  modulo: 'mantenimiento' | 'refaccion' | 'gasto' | 'solicitud' | 'recorrido' | string
  accion: string
  vehiculo: string | null
  motivo: string | null
  usuario: string | null
  antes: Record<string, unknown> | null
  despues: Record<string, unknown> | null
  referencia: string | null // folio de solicitud, etc.
}

const MODULOS: Record<string, { label: string; emoji: string }> = {
  mantenimiento: { label: 'Mantenimiento', emoji: '🛠️' },
  refaccion: { label: 'Refacción', emoji: '🔩' },
  gasto: { label: 'Otro gasto', emoji: '🧰' },
  solicitud: { label: 'Solicitud de combustible', emoji: '📨' },
  recorrido: { label: 'Recorrido', emoji: '🛣️' },
}

function esEliminacion(accion: string): boolean {
  return accion.includes('elimina')
}

function accionUI(accion: string): { label: string; badge: string; rowBg: string } {
  if (esEliminacion(accion)) {
    return {
      label: 'Eliminado',
      badge: 'bg-red-100 text-red-700 border-red-200',
      rowBg: 'bg-red-50 border-red-200',
    }
  }
  const especiales: Record<string, string> = {
    reabrir: 'Reabierto',
    cerrar: 'Cerrado',
    agregar_parada: 'Parada agregada',
    editar_parada: 'Parada editada',
    editar_recorrido: 'Editado',
    edicion_admin: 'Editado',
  }
  return {
    label: especiales[accion] ?? 'Editado',
    badge: 'bg-orange-100 text-orange-700 border-orange-200',
    rowBg: 'bg-orange-50 border-orange-200',
  }
}

// Etiquetas legibles para los campos que aparecen en antes/después
const CAMPO_LABELS: Record<string, string> = {
  tipo: 'Tipo',
  descripcion: 'Descripción',
  lugar: 'Lugar / taller',
  km_al_ingreso: 'KM al ingreso',
  fecha_ingreso: 'Fecha de ingreso',
  fecha_salida: 'Fecha de salida',
  costo: 'Costo',
  observaciones: 'Observaciones',
  factura_path: 'Foto de factura',
  nombre: 'Nombre',
  motivo: 'Motivo de compra',
  proveedor: 'Proveedor',
  fecha_compra: 'Fecha de compra',
  km_al_momento: 'KM de la unidad',
  mantenimiento_id: 'Mantenimiento ligado',
  vehiculo_codigo: 'Vehículo',
  estado: 'Estado',
  monto_autorizado: 'Monto autorizado',
  motivo_rechazo: 'Motivo de rechazo',
  autorizado_por: 'Autorizado / resuelto por',
  cargado_por: 'Cargado por (Edenred)',
  estado_al_eliminar: 'Estado al eliminar',
  monto_solicitado: 'Monto solicitado',
  km_salida: 'KM salida',
  km_regreso: 'KM regreso',
  combustible_salida: 'Combustible salida',
  combustible_regreso: 'Combustible regreso',
}

function labelCampo(campo: string): string {
  return CAMPO_LABELS[campo] ?? campo
}

function formatValor(campo: string, valor: unknown): string {
  if (valor == null || valor === '') return '—'
  if (campo === 'factura_path') return '📷 foto'
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valor)) return formatFecha(valor)
  return String(valor)
}

export default function HistorialAdminView() {
  const router = useRouter()

  const [eventos, setEventos] = useState<EventoHistorial[]>([])
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([])
  const [fuentesSinMigrar, setFuentesSinMigrar] = useState<string[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const [filtroModulo, setFiltroModulo] = useState('')
  const [filtroVehiculo, setFiltroVehiculo] = useState('')
  const [filtroAccion, setFiltroAccion] = useState('')
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    setError('')
    try {
      const { data: vehs } = await supabase.from('vehiculos').select('*').order('codigo')
      setVehiculos((vehs as Vehiculo[]) ?? [])

      const acumulado: EventoHistorial[] = []
      const sinMigrar: string[] = []

      // 1. Auditoría unificada (mantenimientos, refacciones, gastos) — fase 9
      const { data: aud, error: errAud } = await (supabase.from('auditoria_admin') as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300)
      if (errAud) {
        sinMigrar.push('mantenimientos/refacciones/gastos (mejoras_fase9_bucket_auditoria_admin.sql)')
      } else {
        for (const a of (aud as any[]) ?? []) {
          acumulado.push({
            id: `aud-${a.id}`,
            fecha: a.created_at,
            modulo: a.modulo,
            accion: a.accion,
            vehiculo: a.vehiculo_codigo,
            motivo: a.motivo,
            usuario: null,
            antes: a.antes,
            despues: a.despues,
            referencia: null,
          })
        }
      }

      // 2. Solicitudes de combustible: solo cambios administrativos — fase 7
      const { data: sols, error: errSols } = await (supabase
        .from('solicitudes_combustible_auditoria') as any)
        .select('*, solicitudes_combustible(folio, vehiculo_codigo)')
        .in('accion', ['edicion_admin', 'eliminacion_admin'])
        .order('created_at', { ascending: false })
        .limit(300)
      if (errSols) {
        sinMigrar.push('solicitudes (mejoras_fase7_solicitudes_edicion_admin.sql)')
      } else {
        for (const s of (sols as any[]) ?? []) {
          acumulado.push({
            id: `sol-${s.id}`,
            fecha: s.created_at,
            modulo: 'solicitud',
            accion: s.accion,
            vehiculo: s.solicitudes_combustible?.vehiculo_codigo ?? null,
            motivo: s.comentario,
            usuario: s.usuario,
            antes: s.accion === 'eliminacion_admin' ? s.metadata : (s.metadata?.antes ?? null),
            despues: s.accion === 'eliminacion_admin' ? null : (s.metadata?.despues ?? null),
            referencia: s.solicitudes_combustible?.folio ?? null,
          })
        }
      }

      // 3. Recorridos: cambios desde /admin/recorridos — fase 1
      const { data: recs, error: errRecs } = await (supabase
        .from('recorridos_auditoria') as any)
        .select('*, recorridos(vehiculo_codigo)')
        .order('created_at', { ascending: false })
        .limit(300)
      if (errRecs) {
        sinMigrar.push('recorridos (mejoras_fase1_recorridos_admin.sql)')
      } else {
        for (const r of (recs as any[]) ?? []) {
          acumulado.push({
            id: `rec-${r.id}`,
            fecha: r.created_at,
            modulo: 'recorrido',
            accion: r.accion,
            vehiculo: r.recorridos?.vehiculo_codigo ?? null,
            motivo: r.comentario,
            usuario: r.realizado_por,
            antes: r.datos_anteriores,
            despues: r.datos_nuevos,
            referencia: null,
          })
        }
      }

      acumulado.sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
      setEventos(acumulado)
      setFuentesSinMigrar(sinMigrar)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cargar el historial')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const apodoDe = (codigo: string) => {
    const v = vehiculos.find((x) => x.codigo === codigo)
    return v?.apodo ? `${codigo} · ${v.apodo}` : codigo
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando historial de cambios..." />
      </div>
    )
  }

  const filtrados = eventos.filter((ev) => {
    if (filtroModulo && ev.modulo !== filtroModulo) return false
    if (filtroVehiculo && ev.vehiculo !== filtroVehiculo) return false
    if (filtroAccion === 'eliminacion' && !esEliminacion(ev.accion)) return false
    if (filtroAccion === 'edicion' && esEliminacion(ev.accion)) return false
    const fecha = ev.fecha.slice(0, 10)
    if (filtroDesde && fecha < filtroDesde) return false
    if (filtroHasta && fecha > filtroHasta) return false
    return true
  })

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-slate-700 text-white px-4 py-5 shadow flex items-center gap-3">
        <button
          onClick={() => router.push('/admin')}
          className="text-slate-300 hover:text-white transition-colors"
          aria-label="Volver"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Historial de cambios</h1>
          <p className="text-slate-300 text-sm mt-0.5">
            Ediciones y eliminaciones administrativas de todos los módulos
          </p>
        </div>
      </header>

      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {fuentesSinMigrar.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800">
            ⚠️ Aún no hay bitácora de: {fuentesSinMigrar.join(' · ')}. Ejecuta esas migraciones
            para verlas aquí.
          </div>
        )}

        {/* Filtros */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Módulo"
              value={filtroModulo}
              onChange={(e) => setFiltroModulo(e.target.value)}
              options={Object.entries(MODULOS).map(([value, m]) => ({
                value,
                label: `${m.emoji} ${m.label}`,
              }))}
              placeholder="Todos"
            />
            <Select
              label="Vehículo"
              value={filtroVehiculo}
              onChange={(e) => setFiltroVehiculo(e.target.value)}
              options={vehiculos.map((v) => ({ value: v.codigo, label: apodoDe(v.codigo) }))}
              placeholder="Todos"
            />
            <Select
              label="Acción"
              value={filtroAccion}
              onChange={(e) => setFiltroAccion(e.target.value)}
              options={[
                { value: 'edicion', label: 'Ediciones' },
                { value: 'eliminacion', label: 'Eliminaciones' },
              ]}
              placeholder="Todas"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Desde"
                type="date"
                value={filtroDesde}
                onChange={(e) => setFiltroDesde(e.target.value)}
              />
              <Input
                label="Hasta"
                type="date"
                value={filtroHasta}
                onChange={(e) => setFiltroHasta(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 text-sm text-gray-500">
          {filtrados.length} cambio(s)
        </div>

        {/* Lista de eventos */}
        {filtrados.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-gray-500 text-sm">
            Sin cambios administrativos con esos filtros.
          </div>
        ) : (
          filtrados.map((ev) => {
            const ui = accionUI(ev.accion)
            const mod = MODULOS[ev.modulo] ?? { label: ev.modulo, emoji: '📄' }
            const campos = Array.from(
              new Set([
                ...Object.keys(ev.antes ?? {}),
                ...Object.keys(ev.despues ?? {}),
              ])
            )
            return (
              <div key={ev.id} className={`rounded-2xl border shadow-sm p-4 space-y-2 ${ui.rowBg}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-lg leading-none">{mod.emoji}</span>
                    <span className="text-sm font-semibold text-gray-900">{mod.label}</span>
                    {ev.vehiculo && (
                      <span className="font-mono text-xs text-gray-600">{ev.vehiculo}</span>
                    )}
                    {ev.referencia && (
                      <span className="font-mono text-xs text-gray-500">{ev.referencia}</span>
                    )}
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${ui.badge}`}>
                    {ui.label}
                  </span>
                </div>

                <p className="text-xs text-gray-500">
                  {formatFecha(ev.fecha)}
                  {ev.usuario && <> · por {ev.usuario}</>}
                </p>

                {ev.motivo && (
                  <p className="text-sm text-gray-700">
                    <span className="font-medium">Motivo:</span> {ev.motivo}
                  </p>
                )}

                {/* Tabla antes / después */}
                {campos.length > 0 && (
                  <div className="bg-white/70 rounded-xl border border-gray-200 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 text-left">
                          <th className="px-3 py-1.5 font-medium">Campo</th>
                          <th className="px-3 py-1.5 font-medium">Antes</th>
                          {!esEliminacion(ev.accion) && (
                            <th className="px-3 py-1.5 font-medium">Después</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {campos.map((campo) => (
                          <tr key={campo} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 text-gray-500">{labelCampo(campo)}</td>
                            <td className="px-3 py-1.5 text-gray-700">
                              {formatValor(campo, ev.antes?.[campo])}
                            </td>
                            {!esEliminacion(ev.accion) && (
                              <td className="px-3 py-1.5 font-medium text-gray-900">
                                {formatValor(campo, ev.despues?.[campo])}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })
        )}
      </main>
    </div>
  )
}
