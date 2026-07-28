'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Piezas compartidas del módulo de mantenimientos:
// datos, semáforo preventivo y componentes comunes que usan
// el hub y las secciones (unidades, historial, refacciones, gastos).

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Vehiculo, type Mantenimiento, type Refaccion } from '@/lib/supabase'
import Input from '@/components/common/Input'
import PhotoCapture from '@/components/forms/PhotoCapture'
import { comprimirFoto } from '@/lib/imageCompression'
import { buildFotoMantenimientoPath, subirFotoMantenimiento } from '@/utils/storage'
import {
  MANTENIMIENTO_PREALERTA_DIAS,
  MANTENIMIENTO_PREALERTA_KM,
  MANTENIMIENTO_VENTANA_KM_DIARIO_DIAS,
  mantenimientoTipoLabel,
} from '@/lib/constants'
import { formatFecha } from '@/utils/formatters'

// ── Semáforo preventivo ────────────────────────────────────
export type Semaforo = 'en_taller' | 'vencido' | 'proximo' | 'al_dia' | 'sin_programa'

export const SEMAFORO_UI: Record<Semaforo, { label: string; badge: string; barra: string }> = {
  en_taller: { label: '🔧 En taller', badge: 'bg-amber-100 text-amber-800 border-amber-300', barra: 'bg-amber-500' },
  vencido: { label: '🔴 Vencido', badge: 'bg-red-100 text-red-800 border-red-300', barra: 'bg-red-500' },
  proximo: { label: '🟡 Próximo', badge: 'bg-yellow-100 text-yellow-800 border-yellow-300', barra: 'bg-yellow-400' },
  al_dia: { label: '🟢 Al día', badge: 'bg-green-100 text-green-800 border-green-300', barra: 'bg-green-500' },
  sin_programa: { label: 'Sin programa', badge: 'bg-gray-100 text-gray-600 border-gray-200', barra: 'bg-gray-300' },
}

export interface SemaforoInfo {
  semaforo: Semaforo
  proximoKm: number | null
  faltanKm: number | null
  fechaEstimada: Date | null
  // Avance dentro del intervalo actual (0-1), para la barra de progreso
  progreso: number | null
}

// El próximo servicio se cuenta a partir del km real del último
// mantenimiento registrado (km_ultimo_mantenimiento) + el intervalo
// configurado — un umbral que rueda con el uso real de la unidad, ya
// no un múltiplo fijo de 10,000 desde el km 0.
export function calcularSemaforo(
  v: Vehiculo,
  kmDiario: number,
  enTaller: boolean
): SemaforoInfo {
  if (v.estado === 'mantenimiento' || enTaller) {
    return { semaforo: 'en_taller', proximoKm: null, faltanKm: null, fechaEstimada: null, progreso: null }
  }
  const intervalo = v.intervalo_mantenimiento_km
  if (intervalo == null || intervalo <= 0) {
    return { semaforo: 'sin_programa', proximoKm: null, faltanKm: null, fechaEstimada: null, progreso: null }
  }
  const kmBase = v.km_ultimo_mantenimiento ?? 0
  const proximoKm = kmBase + intervalo
  const faltanKm = proximoKm - v.km_actual
  const progreso = Math.min(1, Math.max(0, (v.km_actual - kmBase) / intervalo))
  const fechaEstimada =
    faltanKm > 0 && kmDiario > 0
      ? new Date(Date.now() + (faltanKm / kmDiario) * 24 * 3600 * 1000)
      : null

  // Pre-alerta: ~1 semana de km al ritmo de la unidad; si no hay ritmo
  // conocido, respaldo fijo en km
  const prealertaKm = kmDiario > 0 ? kmDiario * MANTENIMIENTO_PREALERTA_DIAS : MANTENIMIENTO_PREALERTA_KM
  const semaforo: Semaforo =
    faltanKm <= 0 ? 'vencido' : faltanKm <= prealertaKm ? 'proximo' : 'al_dia'
  return { semaforo, proximoKm, faltanKm, fechaEstimada, progreso }
}

// ── Helpers de fecha ───────────────────────────────────────
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function localInputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

export function hoyLocalInput(): string {
  return isoToLocalInput(new Date().toISOString())
}

export function hoyDateInput(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function diasEnTaller(m: Mantenimiento): number | null {
  if (!m.fecha_ingreso) return null
  const fin = m.fecha_salida ? new Date(m.fecha_salida).getTime() : Date.now()
  const dias = (fin - new Date(m.fecha_ingreso).getTime()) / (24 * 3600 * 1000)
  return Math.max(0, Math.round(dias * 10) / 10)
}

// Cuando un mantenimiento preventivo no trae km_al_ingreso (p.ej. un
// ingreso excepcional con "kilometraje no disponible"), se usa el tiempo
// como referencia: el km_salida del recorrido más reciente de esa unidad
// con fecha_salida <= fechaReferencia (sin importar si ese recorrido
// sigue abierto o ya se cerró). Si no hay ningún recorrido previo, no hay
// forma de estimar y se devuelve null — el km debe pedirse manualmente.
export async function estimarKmMantenimientoPorFecha(
  vehiculoCodigo: string,
  fechaReferencia: string
): Promise<number | null> {
  const { data } = await supabase
    .from('recorridos')
    .select('km_salida')
    .eq('vehiculo_codigo', vehiculoCodigo)
    .lte('fecha_salida', fechaReferencia)
    .order('fecha_salida', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { km_salida: number } | null)?.km_salida ?? null
}

// ── Datos compartidos del módulo ───────────────────────────
export interface MantenimientosData {
  vehiculos: Vehiculo[]
  mantenimientos: Mantenimiento[]
  refacciones: Refaccion[]
  kmDiario: Record<string, number>
  cargando: boolean
  error: string
  // La tabla mantenimientos no existe (falta fase 4)
  requiereMigracion: boolean
  // La tabla refacciones no existe (falta fase 5)
  requiereMigracionRef: boolean
  // La columna categoria no existe (falta fase 8)
  requiereMigracionCategoria: boolean
  // La tabla auditoria_admin no existe (falta fase 9):
  // sin ella no se permite editar/eliminar, para no perder el historial
  requiereMigracionAuditoria: boolean
  recargar: () => Promise<void>
  apodoDe: (codigo: string) => string
  mantenimientoEnTaller: (codigo: string) => Mantenimiento | null
  semaforoDe: (v: Vehiculo) => SemaforoInfo
}

export function useMantenimientosData(): MantenimientosData {
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([])
  const [mantenimientos, setMantenimientos] = useState<Mantenimiento[]>([])
  const [refacciones, setRefacciones] = useState<Refaccion[]>([])
  const [kmDiario, setKmDiario] = useState<Record<string, number>>({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [requiereMigracion, setRequiereMigracion] = useState(false)
  const [requiereMigracionRef, setRequiereMigracionRef] = useState(false)
  const [requiereMigracionCategoria, setRequiereMigracionCategoria] = useState(false)
  const [requiereMigracionAuditoria, setRequiereMigracionAuditoria] = useState(false)

  const recargar = useCallback(async () => {
    setCargando(true)
    setError('')
    try {
      const { data: vehs, error: errVehs } = await supabase
        .from('vehiculos')
        .select('*')
        .order('codigo')
      if (errVehs) throw errVehs
      setVehiculos((vehs as Vehiculo[]) ?? [])

      // Mantenimientos: la tabla existe solo tras la migración de fase 4
      const { data: mants, error: errMants } = await (supabase.from('mantenimientos') as any)
        .select('*')
        .order('fecha_ingreso', { ascending: false })
        .limit(300)
      if (errMants) {
        setRequiereMigracion(true)
        setMantenimientos([])
      } else {
        setRequiereMigracion(false)
        // eliminado llega con fase 9; si la columna no existe, viene
        // undefined y no se filtra nada
        setMantenimientos(((mants as Mantenimiento[]) ?? []).filter((m) => !m.eliminado))
      }

      // Refacciones: tabla de fase 5; categoria llega con fase 8
      const { data: refs, error: errRefs } = await (supabase.from('refacciones') as any)
        .select('*')
        .order('fecha_compra', { ascending: false })
        .limit(500)
      if (errRefs) {
        setRequiereMigracionRef(true)
        setRefacciones([])
      } else {
        setRequiereMigracionRef(false)
        const filas = ((refs as Refaccion[]) ?? []).filter((r) => !r.eliminado)
        setRefacciones(filas)
        // Si ninguna fila trae categoria y la tabla no está vacía, o la
        // columna no viene en el select *, falta la migración de fase 8
        setRequiereMigracionCategoria(filas.length > 0 && filas[0].categoria === undefined)
      }

      // Auditoría unificada: tabla de fase 9. Sin ella, la edición y
      // eliminación admin quedan deshabilitadas.
      const { error: errAud } = await (supabase.from('auditoria_admin') as any)
        .select('id', { count: 'exact', head: true })
      setRequiereMigracionAuditoria(!!errAud)

      // Km diario promedio por unidad (recorridos cerrados de la ventana)
      const cutoff = new Date(
        Date.now() - MANTENIMIENTO_VENTANA_KM_DIARIO_DIAS * 24 * 3600 * 1000
      ).toISOString()
      const { data: recs } = await supabase
        .from('recorridos')
        .select('vehiculo_codigo, km_salida, km_regreso')
        .eq('estado', 'cerrado')
        .gte('fecha_salida', cutoff)

      const acumulado: Record<string, number> = {}
      for (const r of (recs as { vehiculo_codigo: string; km_salida: number; km_regreso: number | null }[]) ?? []) {
        if (r.km_regreso == null) continue
        acumulado[r.vehiculo_codigo] =
          (acumulado[r.vehiculo_codigo] ?? 0) + (r.km_regreso - r.km_salida)
      }
      const promedio: Record<string, number> = {}
      for (const [codigo, km] of Object.entries(acumulado)) {
        promedio[codigo] = km / MANTENIMIENTO_VENTANA_KM_DIARIO_DIAS
      }
      setKmDiario(promedio)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cargar datos')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { recargar() }, [recargar])

  const apodoDe = useCallback(
    (codigo: string) => {
      const v = vehiculos.find((x) => x.codigo === codigo)
      return v?.apodo ? `${codigo} · ${v.apodo}` : codigo
    },
    [vehiculos]
  )

  const mantenimientoEnTaller = useCallback(
    (codigo: string): Mantenimiento | null =>
      mantenimientos.find((m) => m.vehiculo_codigo === codigo && m.estado === 'en_taller') ?? null,
    [mantenimientos]
  )

  const semaforoDe = useCallback(
    (v: Vehiculo) => calcularSemaforo(v, kmDiario[v.codigo] ?? 0, mantenimientoEnTaller(v.codigo) != null),
    [kmDiario, mantenimientoEnTaller]
  )

  return {
    vehiculos,
    mantenimientos,
    refacciones,
    kmDiario,
    cargando,
    error,
    requiereMigracion,
    requiereMigracionRef,
    requiereMigracionCategoria,
    requiereMigracionAuditoria,
    recargar,
    apodoDe,
    mantenimientoEnTaller,
    semaforoDe,
  }
}

// ── Auditoría administrativa unificada (fase 9) ────────────
export interface EntradaAuditoria {
  modulo: 'mantenimiento' | 'refaccion' | 'gasto'
  registroId: string
  vehiculoCodigo: string | null
  accion: 'edicion_admin' | 'eliminacion_admin'
  motivo: string
  antes?: Record<string, unknown> | null
  despues?: Record<string, unknown> | null
}

export async function registrarAuditoriaAdmin(entrada: EntradaAuditoria): Promise<void> {
  const { error } = await (supabase.from('auditoria_admin') as any).insert({
    modulo: entrada.modulo,
    registro_id: entrada.registroId,
    vehiculo_codigo: entrada.vehiculoCodigo,
    accion: entrada.accion,
    motivo: entrada.motivo.trim(),
    antes: entrada.antes ?? null,
    despues: entrada.despues ?? null,
  })
  if (error) {
    throw new Error(
      `El cambio se guardó pero NO quedó en el historial: ${error.message}. ` +
      'Ejecuta la migración mejoras_fase9_bucket_auditoria_admin.sql.'
    )
  }
}

// Compara dos versiones y devuelve solo los campos que cambiaron
export function diffCampos(
  antes: Record<string, unknown>,
  despues: Record<string, unknown>,
  campos: string[]
): { antes: Record<string, unknown>; despues: Record<string, unknown>; hayCambios: boolean } {
  const a: Record<string, unknown> = {}
  const d: Record<string, unknown> = {}
  for (const campo of campos) {
    const va = antes[campo] ?? null
    const vd = despues[campo] ?? null
    if (JSON.stringify(va) !== JSON.stringify(vd)) {
      a[campo] = va
      d[campo] = vd
    }
  }
  return { antes: a, despues: d, hayCambios: Object.keys(d).length > 0 }
}

// ── Header común de las pantallas del módulo ──────────────
export function MantHeader({
  titulo,
  subtitulo,
  backHref,
}: {
  titulo: string
  subtitulo?: string
  backHref: string
}) {
  const router = useRouter()
  return (
    <header className="bg-slate-700 text-white px-4 py-5 shadow flex items-center gap-3">
      <button
        onClick={() => router.push(backHref)}
        className="text-slate-300 hover:text-white transition-colors"
        aria-label="Volver"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-bold tracking-tight">{titulo}</h1>
        {subtitulo && <p className="text-slate-300 text-sm mt-0.5">{subtitulo}</p>}
      </div>
    </header>
  )
}

export function AvisoMigracion({ script }: { script: string }) {
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800">
      ⚠️ Falta ejecutar la migración{' '}
      <code className="font-mono text-xs bg-amber-100 px-1 rounded">{script}</code>{' '}
      en el SQL editor de Supabase para habilitar esta sección por completo.
    </div>
  )
}

// ── Modal compartido: salida del taller ────────────────────
// Lo usan Unidades e Historial. Al cerrar un preventivo, el km del
// ingreso se vuelve la base del próximo umbral.
export function CierreMantenimientoModal({
  mantenimiento,
  onClose,
  onSaved,
}: {
  mantenimiento: Mantenimiento
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const [fecha, setFecha] = useState(hoyLocalInput())
  const [costo, setCosto] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [errorModal, setErrorModal] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Si es preventivo y no se registró km de ingreso, se intenta estimar
  // por tiempo (km_salida del recorrido previo más reciente). Si no hay
  // ningún recorrido de referencia, se debe pedir el km manualmente.
  const requiereEstimacionKm = mantenimiento.tipo === 'preventivo' && mantenimiento.km_al_ingreso == null
  const [estimandoKm, setEstimandoKm] = useState(requiereEstimacionKm)
  const [kmEstimadoAuto, setKmEstimadoAuto] = useState<number | null>(null)
  const [kmManual, setKmManual] = useState('')

  useEffect(() => {
    if (!requiereEstimacionKm) return
    let activo = true
    estimarKmMantenimientoPorFecha(mantenimiento.vehiculo_codigo, mantenimiento.fecha_ingreso).then((km) => {
      if (activo) {
        setKmEstimadoAuto(km)
        setEstimandoKm(false)
      }
    })
    return () => {
      activo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function guardar() {
    const costoNum = costo ? Number(costo) : null
    if (costo && (isNaN(costoNum!) || costoNum! < 0)) {
      setErrorModal('El costo no es válido.')
      return
    }

    let kmBaseEstimacion: number | null = null
    if (requiereEstimacionKm && kmEstimadoAuto == null) {
      const kmManualNum = kmManual ? Number(kmManual) : null
      if (kmManualNum == null || isNaN(kmManualNum) || kmManualNum < 0) {
        setErrorModal('No se encontró ningún recorrido previo para estimar el km de este mantenimiento: indícalo manualmente.')
        return
      }
      kmBaseEstimacion = kmManualNum
    }

    setGuardando(true)
    try {
      let facturaPath: string | null = null
      if (foto) {
        const comprimida = await comprimirFoto(foto)
        facturaPath = buildFotoMantenimientoPath(mantenimiento.vehiculo_codigo, mantenimiento.id)
        await subirFotoMantenimiento(facturaPath, comprimida)
      }

      const { error: err } = await (supabase.from('mantenimientos') as any)
        .update({
          estado: 'completado',
          fecha_salida: localInputToIso(fecha) ?? new Date().toISOString(),
          costo: costoNum,
          observaciones: observaciones.trim() || null,
          ...(facturaPath ? { factura_path: facturaPath } : {}),
        })
        .eq('id', mantenimiento.id)
      if (err) throw new Error(err.message)

      // Reactivar la unidad
      const { error: errVeh } = await (supabase.from('vehiculos') as any)
        .update({ estado: 'activo' })
        .eq('codigo', mantenimiento.vehiculo_codigo)
      if (errVeh) throw new Error(errVeh.message)

      // Si fue preventivo, reiniciar la base del próximo mantenimiento:
      // km real de ingreso si se registró, si no el estimado por tiempo
      // (recorrido previo) o el capturado manualmente como respaldo.
      if (mantenimiento.tipo === 'preventivo') {
        const kmBase = mantenimiento.km_al_ingreso ?? kmEstimadoAuto ?? kmBaseEstimacion
        if (kmBase != null) {
          await (supabase.from('vehiculos') as any)
            .update({ km_ultimo_mantenimiento: kmBase })
            .eq('codigo', mantenimiento.vehiculo_codigo)
        }
      }

      // Si fue un ingreso excepcional, el recorrido nunca dejó de estar
      // 'abierto' — solo se deja constancia de que se reanuda
      if (mantenimiento.ingreso_excepcional && mantenimiento.recorrido_abierto_id) {
        await (supabase.from('recorridos_auditoria') as any).insert({
          recorrido_id: mantenimiento.recorrido_abierto_id,
          accion: 'reanudar_tras_mantenimiento',
          comentario: 'Recorrido reanudado después de mantenimiento',
          datos_nuevos: { mantenimiento_id: mantenimiento.id },
        })
      }

      await onSaved()
      onClose()
    } catch (e: unknown) {
      setErrorModal(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => !guardando && onClose()} />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <h3 className="text-lg font-bold text-gray-900">
          Salida del taller · {mantenimiento.vehiculo_codigo}
        </h3>
        <p className="text-sm text-gray-600">
          {mantenimientoTipoLabel(mantenimiento.tipo)}: {mantenimiento.descripcion}
          <br />
          En taller desde {formatFecha(mantenimiento.fecha_ingreso)} ({diasEnTaller(mantenimiento)} días).
        </p>
        {mantenimiento.ingreso_excepcional && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-300 rounded-xl px-3 py-2">
            ⚠️ Ingreso excepcional autorizado por <strong>{mantenimiento.autorizado_por}</strong>
            {mantenimiento.motivo_excepcion && <> — {mantenimiento.motivo_excepcion}</>}. El recorrido
            que quedó abierto se reanudará automáticamente al registrar esta salida.
          </p>
        )}
        {errorModal && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{errorModal}</div>
        )}
        {requiereEstimacionKm && estimandoKm && (
          <p className="text-sm text-gray-500">Calculando km de referencia para el programa preventivo...</p>
        )}
        {requiereEstimacionKm && !estimandoKm && kmEstimadoAuto != null && (
          <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
            No se registró el km de ingreso. Como base del próximo servicio se usará el km de salida
            del recorrido previo más reciente: <strong>{kmEstimadoAuto.toLocaleString()} km</strong>.
          </p>
        )}
        {requiereEstimacionKm && !estimandoKm && kmEstimadoAuto == null && (
          <div className="space-y-1">
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2">
              No se encontró ningún recorrido previo para estimar el km de este mantenimiento.
              Indícalo manualmente para poder calcular el próximo servicio.
            </p>
            <Input
              label="KM aproximado en ese momento"
              type="number"
              inputMode="numeric"
              value={kmManual}
              onChange={(e) => setKmManual(e.target.value)}
            />
          </div>
        )}
        <Input
          label="Fecha de salida del taller"
          type="datetime-local"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
        />
        <Input
          label="Costo total (MXN)"
          type="number"
          inputMode="decimal"
          step="0.01"
          value={costo}
          onChange={(e) => setCosto(e.target.value)}
          placeholder="Ej: 2500.00"
        />
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Observaciones</label>
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            placeholder="Trabajos realizados, garantía, etc."
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <PhotoCapture label="Foto de factura / nota (opcional)" onPhoto={setFoto} />
        {mantenimiento.tipo === 'preventivo' && mantenimiento.km_al_ingreso != null && (
          <p className="text-xs text-gray-500">
            Al cerrar, el próximo servicio se programará sumando el intervalo a los{' '}
            {mantenimiento.km_al_ingreso.toLocaleString()} km del ingreso.
          </p>
        )}
        <div className="flex gap-3">
          <button onClick={onClose} disabled={guardando}
            className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-40">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {guardando && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Registrar salida
          </button>
        </div>
      </div>
    </div>
  )
}
