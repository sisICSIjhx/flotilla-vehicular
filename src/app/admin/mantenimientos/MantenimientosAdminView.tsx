'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  supabase,
  type Vehiculo,
  type Mantenimiento,
  type Refaccion,
  type MantenimientoTipo,
} from '@/lib/supabase'
import Loading from '@/components/common/Loading'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import PhotoCapture from '@/components/forms/PhotoCapture'
import { comprimirFoto } from '@/lib/imageCompression'
import {
  buildFotoMantenimientoPath,
  buildFotoRefaccionPath,
  subirFoto,
  getPublicUrl,
} from '@/utils/storage'
import {
  MANTENIMIENTO_TIPOS,
  MANTENIMIENTO_ESTADOS,
  MANTENIMIENTO_PREALERTA_KM,
  MANTENIMIENTO_VENTANA_KM_DIARIO_DIAS,
  mantenimientoTipoLabel,
} from '@/lib/constants'
import { formatFecha, formatMoneda } from '@/utils/formatters'

type Tab = 'unidades' | 'historial' | 'refacciones'

// Estado del semáforo preventivo de una unidad
type Semaforo = 'en_taller' | 'vencido' | 'proximo' | 'al_dia' | 'sin_programa'

const SEMAFORO_UI: Record<Semaforo, { label: string; badge: string }> = {
  en_taller: { label: '🔧 En taller', badge: 'bg-amber-100 text-amber-800 border-amber-300' },
  vencido: { label: '🔴 Vencido', badge: 'bg-red-100 text-red-800 border-red-300' },
  proximo: { label: '🟡 Próximo', badge: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  al_dia: { label: '🟢 Al día', badge: 'bg-green-100 text-green-800 border-green-300' },
  sin_programa: { label: 'Sin programa', badge: 'bg-gray-100 text-gray-600 border-gray-200' },
}

function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

function hoyLocalInput(): string {
  return isoToLocalInput(new Date().toISOString())
}

function hoyDateInput(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function diasEnTaller(m: Mantenimiento): number | null {
  if (!m.fecha_ingreso) return null
  const fin = m.fecha_salida ? new Date(m.fecha_salida).getTime() : Date.now()
  const dias = (fin - new Date(m.fecha_ingreso).getTime()) / (24 * 3600 * 1000)
  return Math.max(0, Math.round(dias * 10) / 10)
}

export default function MantenimientosAdminView() {
  const router = useRouter()

  const [tab, setTab] = useState<Tab>('unidades')
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([])
  const [mantenimientos, setMantenimientos] = useState<Mantenimiento[]>([])
  const [refacciones, setRefacciones] = useState<Refaccion[]>([])
  const [kmDiario, setKmDiario] = useState<Record<string, number>>({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [requiereMigracion, setRequiereMigracion] = useState(false)
  const [requiereMigracionRef, setRequiereMigracionRef] = useState(false)

  // Filtro de historial / refacciones
  const [filtroVehiculo, setFiltroVehiculo] = useState('')

  // Modal configurar programa
  const [programaVehiculo, setProgramaVehiculo] = useState<Vehiculo | null>(null)
  const [programaIntervalo, setProgramaIntervalo] = useState('')
  const [programaKmUltimo, setProgramaKmUltimo] = useState('')
  const [programaError, setProgramaError] = useState('')
  const [guardandoPrograma, setGuardandoPrograma] = useState(false)

  // Modal ingreso a taller
  const [ingresoVehiculo, setIngresoVehiculo] = useState<Vehiculo | null>(null)
  const [ingresoTipo, setIngresoTipo] = useState<MantenimientoTipo>('preventivo')
  const [ingresoDescripcion, setIngresoDescripcion] = useState('')
  const [ingresoLugar, setIngresoLugar] = useState('')
  const [ingresoKm, setIngresoKm] = useState('')
  const [ingresoFecha, setIngresoFecha] = useState('')
  const [ingresoError, setIngresoError] = useState('')
  const [guardandoIngreso, setGuardandoIngreso] = useState(false)

  // Modal cierre de mantenimiento
  const [cierreMantenimiento, setCierreMantenimiento] = useState<Mantenimiento | null>(null)
  const [cierreFecha, setCierreFecha] = useState('')
  const [cierreCosto, setCierreCosto] = useState('')
  const [cierreObservaciones, setCierreObservaciones] = useState('')
  const [cierreFoto, setCierreFoto] = useState<File | null>(null)
  const [cierreError, setCierreError] = useState('')
  const [guardandoCierre, setGuardandoCierre] = useState(false)

  // Modal refacción (alta/edición)
  const [refaccionModal, setRefaccionModal] = useState(false)
  const [refaccionEditando, setRefaccionEditando] = useState<Refaccion | null>(null)
  const [refVehiculo, setRefVehiculo] = useState('')
  const [refNombre, setRefNombre] = useState('')
  const [refMotivo, setRefMotivo] = useState('')
  const [refCosto, setRefCosto] = useState('')
  const [refProveedor, setRefProveedor] = useState('')
  const [refFecha, setRefFecha] = useState('')
  const [refKm, setRefKm] = useState('')
  const [refMantenimientoId, setRefMantenimientoId] = useState('')
  const [refObservaciones, setRefObservaciones] = useState('')
  const [refFoto, setRefFoto] = useState<File | null>(null)
  const [refError, setRefError] = useState('')
  const [guardandoRef, setGuardandoRef] = useState(false)
  const [refAEliminar, setRefAEliminar] = useState<Refaccion | null>(null)
  const [eliminandoRef, setEliminandoRef] = useState(false)

  // ── Carga de datos ─────────────────────────────────────
  const cargarDatos = useCallback(async () => {
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
        .limit(200)
      if (errMants) {
        setRequiereMigracion(true)
        setMantenimientos([])
      } else {
        setRequiereMigracion(false)
        setMantenimientos((mants as Mantenimiento[]) ?? [])
      }

      // Refacciones: tabla de fase 5
      const { data: refs, error: errRefs } = await (supabase.from('refacciones') as any)
        .select('*')
        .order('fecha_compra', { ascending: false })
        .limit(300)
      if (errRefs) {
        setRequiereMigracionRef(true)
        setRefacciones([])
      } else {
        setRequiereMigracionRef(false)
        setRefacciones((refs as Refaccion[]) ?? [])
      }

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

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // ── Semáforo por unidad ────────────────────────────────
  const mantenimientoEnTaller = useCallback(
    (codigo: string): Mantenimiento | null =>
      mantenimientos.find((m) => m.vehiculo_codigo === codigo && m.estado === 'en_taller') ?? null,
    [mantenimientos]
  )

  function calcularSemaforo(v: Vehiculo): {
    semaforo: Semaforo
    proximoKm: number | null
    faltanKm: number | null
    fechaEstimada: Date | null
  } {
    if (v.estado === 'mantenimiento' || mantenimientoEnTaller(v.codigo)) {
      return { semaforo: 'en_taller', proximoKm: null, faltanKm: null, fechaEstimada: null }
    }
    if (v.intervalo_mantenimiento_km == null) {
      return { semaforo: 'sin_programa', proximoKm: null, faltanKm: null, fechaEstimada: null }
    }
    const proximoKm = (v.km_ultimo_mantenimiento ?? 0) + v.intervalo_mantenimiento_km
    const faltanKm = proximoKm - v.km_actual
    const diario = kmDiario[v.codigo] ?? 0
    const fechaEstimada =
      faltanKm > 0 && diario > 0
        ? new Date(Date.now() + (faltanKm / diario) * 24 * 3600 * 1000)
        : null

    const semaforo: Semaforo =
      faltanKm <= 0 ? 'vencido' : faltanKm <= MANTENIMIENTO_PREALERTA_KM ? 'proximo' : 'al_dia'
    return { semaforo, proximoKm, faltanKm, fechaEstimada }
  }

  const alertas = vehiculos
    .filter((v) => v.estado !== 'inactivo')
    .map((v) => ({ v, info: calcularSemaforo(v) }))
    .filter(({ info }) => info.semaforo === 'vencido' || info.semaforo === 'proximo')

  // ── Configurar programa ────────────────────────────────
  function abrirPrograma(v: Vehiculo) {
    setProgramaVehiculo(v)
    setProgramaIntervalo(v.intervalo_mantenimiento_km?.toString() ?? '')
    setProgramaKmUltimo((v.km_ultimo_mantenimiento ?? v.km_actual).toString())
    setProgramaError('')
  }

  async function guardarPrograma() {
    if (!programaVehiculo) return
    const intervalo = Number(programaIntervalo)
    if (!programaIntervalo || isNaN(intervalo) || intervalo <= 0) {
      setProgramaError('El intervalo debe ser un número de km mayor a 0 (ej. 10000).')
      return
    }
    const kmUltimo = Number(programaKmUltimo)
    if (programaKmUltimo === '' || isNaN(kmUltimo) || kmUltimo < 0) {
      setProgramaError('El km del último mantenimiento no es válido.')
      return
    }

    setGuardandoPrograma(true)
    try {
      const { error: err } = await (supabase.from('vehiculos') as any)
        .update({
          intervalo_mantenimiento_km: intervalo,
          km_ultimo_mantenimiento: kmUltimo,
        })
        .eq('codigo', programaVehiculo.codigo)
      if (err) {
        if (err.message.includes('intervalo_mantenimiento_km') || err.message.includes('km_ultimo_mantenimiento')) {
          throw new Error('Ejecuta la migración mejoras_fase4_mantenimientos.sql en Supabase para habilitar el programa preventivo.')
        }
        throw new Error(err.message)
      }
      setProgramaVehiculo(null)
      await cargarDatos()
    } catch (e: unknown) {
      setProgramaError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardandoPrograma(false)
    }
  }

  // ── Ingreso a taller ───────────────────────────────────
  function abrirIngreso(v: Vehiculo) {
    setIngresoVehiculo(v)
    setIngresoTipo('preventivo')
    setIngresoDescripcion('')
    setIngresoLugar('')
    setIngresoKm(v.km_actual.toString())
    setIngresoFecha(hoyLocalInput())
    setIngresoError('')
  }

  async function guardarIngreso() {
    if (!ingresoVehiculo) return
    if (!ingresoDescripcion.trim()) {
      setIngresoError('Describe el mantenimiento que se realizará.')
      return
    }

    setGuardandoIngreso(true)
    try {
      // Un vehículo en ruta no puede entrar al taller
      const { data: abierto } = await supabase
        .from('recorridos')
        .select('id')
        .eq('vehiculo_codigo', ingresoVehiculo.codigo)
        .eq('estado', 'abierto')
        .maybeSingle()
      if (abierto) {
        throw new Error('Este vehículo tiene un recorrido abierto. Ciérralo antes de ingresarlo al taller.')
      }

      const { error: err } = await (supabase.from('mantenimientos') as any).insert({
        vehiculo_codigo: ingresoVehiculo.codigo,
        tipo: ingresoTipo,
        estado: 'en_taller',
        descripcion: ingresoDescripcion.trim(),
        lugar: ingresoLugar.trim() || null,
        km_al_ingreso: ingresoKm ? Number(ingresoKm) : null,
        fecha_ingreso: localInputToIso(ingresoFecha) ?? new Date().toISOString(),
      })
      if (err) {
        if (err.message.includes('mantenimientos')) {
          throw new Error('Ejecuta la migración mejoras_fase4_mantenimientos.sql en Supabase.')
        }
        throw new Error(err.message)
      }

      // Deshabilitar la unidad mientras está en taller
      const { error: errVeh } = await (supabase.from('vehiculos') as any)
        .update({ estado: 'mantenimiento' })
        .eq('codigo', ingresoVehiculo.codigo)
      if (errVeh) throw new Error(errVeh.message)

      setIngresoVehiculo(null)
      await cargarDatos()
    } catch (e: unknown) {
      setIngresoError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardandoIngreso(false)
    }
  }

  // ── Cierre de mantenimiento ────────────────────────────
  function abrirCierre(m: Mantenimiento) {
    setCierreMantenimiento(m)
    setCierreFecha(hoyLocalInput())
    setCierreCosto('')
    setCierreObservaciones('')
    setCierreFoto(null)
    setCierreError('')
  }

  async function guardarCierre() {
    if (!cierreMantenimiento) return
    const costo = cierreCosto ? Number(cierreCosto) : null
    if (cierreCosto && (isNaN(costo!) || costo! < 0)) {
      setCierreError('El costo no es válido.')
      return
    }

    setGuardandoCierre(true)
    try {
      let facturaPath: string | null = null
      if (cierreFoto) {
        const comprimida = await comprimirFoto(cierreFoto)
        facturaPath = buildFotoMantenimientoPath(
          cierreMantenimiento.vehiculo_codigo,
          cierreMantenimiento.id
        )
        await subirFoto(facturaPath, comprimida)
      }

      const { error: err } = await (supabase.from('mantenimientos') as any)
        .update({
          estado: 'completado',
          fecha_salida: localInputToIso(cierreFecha) ?? new Date().toISOString(),
          costo,
          observaciones: cierreObservaciones.trim() || null,
          ...(facturaPath ? { factura_path: facturaPath } : {}),
        })
        .eq('id', cierreMantenimiento.id)
      if (err) throw new Error(err.message)

      // Reactivar la unidad
      const { error: errVeh } = await (supabase.from('vehiculos') as any)
        .update({ estado: 'activo' })
        .eq('codigo', cierreMantenimiento.vehiculo_codigo)
      if (errVeh) throw new Error(errVeh.message)

      // Si fue preventivo, reiniciar la base del próximo mantenimiento
      if (cierreMantenimiento.tipo === 'preventivo' && cierreMantenimiento.km_al_ingreso != null) {
        await (supabase.from('vehiculos') as any)
          .update({ km_ultimo_mantenimiento: cierreMantenimiento.km_al_ingreso })
          .eq('codigo', cierreMantenimiento.vehiculo_codigo)
      }

      setCierreMantenimiento(null)
      await cargarDatos()
    } catch (e: unknown) {
      setCierreError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardandoCierre(false)
    }
  }

  // ── Refacciones ────────────────────────────────────────
  function abrirNuevaRefaccion() {
    setRefaccionEditando(null)
    setRefVehiculo(filtroVehiculo || '')
    setRefNombre('')
    setRefMotivo('')
    setRefCosto('')
    setRefProveedor('')
    setRefFecha(hoyDateInput())
    setRefKm('')
    setRefMantenimientoId('')
    setRefObservaciones('')
    setRefFoto(null)
    setRefError('')
    setRefaccionModal(true)
  }

  function abrirEdicionRefaccion(r: Refaccion) {
    setRefaccionEditando(r)
    setRefVehiculo(r.vehiculo_codigo)
    setRefNombre(r.nombre)
    setRefMotivo(r.motivo)
    setRefCosto(String(r.costo))
    setRefProveedor(r.proveedor ?? '')
    setRefFecha(r.fecha_compra?.slice(0, 10) ?? hoyDateInput())
    setRefKm(r.km_al_momento != null ? String(r.km_al_momento) : '')
    setRefMantenimientoId(r.mantenimiento_id ?? '')
    setRefObservaciones(r.observaciones ?? '')
    setRefFoto(null)
    setRefError('')
    setRefaccionModal(true)
  }

  async function guardarRefaccion() {
    if (!refVehiculo) { setRefError('Selecciona el vehículo.'); return }
    if (!refNombre.trim()) { setRefError('Escribe el nombre de la refacción.'); return }
    if (!refMotivo.trim()) { setRefError('Escribe el motivo de la compra.'); return }
    const costo = Number(refCosto)
    if (!refCosto || isNaN(costo) || costo < 0) { setRefError('El costo no es válido.'); return }
    if (!refFecha) { setRefError('Selecciona la fecha de compra.'); return }

    setGuardandoRef(true)
    try {
      const id = refaccionEditando?.id ?? crypto.randomUUID()

      let facturaPath: string | null = refaccionEditando?.factura_path ?? null
      if (refFoto) {
        const comprimida = await comprimirFoto(refFoto)
        facturaPath = buildFotoRefaccionPath(refVehiculo, id)
        await subirFoto(facturaPath, comprimida)
      }

      const payload = {
        vehiculo_codigo: refVehiculo,
        mantenimiento_id: refMantenimientoId || null,
        nombre: refNombre.trim(),
        motivo: refMotivo.trim(),
        costo,
        proveedor: refProveedor.trim() || null,
        fecha_compra: refFecha,
        km_al_momento: refKm ? Number(refKm) : null,
        factura_path: facturaPath,
        observaciones: refObservaciones.trim() || null,
      }

      let err
      if (refaccionEditando) {
        const res = await (supabase.from('refacciones') as any).update(payload).eq('id', id)
        err = res.error
      } else {
        const res = await (supabase.from('refacciones') as any).insert({ ...payload, id })
        err = res.error
      }
      if (err) {
        if (err.message.includes('refacciones')) {
          throw new Error('Ejecuta la migración mejoras_fase5_refacciones.sql en Supabase.')
        }
        throw new Error(err.message)
      }

      setRefaccionModal(false)
      await cargarDatos()
    } catch (e: unknown) {
      setRefError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardandoRef(false)
    }
  }

  async function eliminarRefaccion() {
    if (!refAEliminar) return
    setEliminandoRef(true)
    try {
      const { error: err } = await (supabase.from('refacciones') as any)
        .delete()
        .eq('id', refAEliminar.id)
      if (err) throw new Error(err.message)
      setRefAEliminar(null)
      await cargarDatos()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setRefAEliminar(null)
    } finally {
      setEliminandoRef(false)
    }
  }

  // ── Datos filtrados ────────────────────────────────────
  const mantenimientosFiltrados = mantenimientos.filter(
    (m) => !filtroVehiculo || m.vehiculo_codigo === filtroVehiculo
  )
  const refaccionesFiltradas = refacciones.filter(
    (r) => !filtroVehiculo || r.vehiculo_codigo === filtroVehiculo
  )
  const totalMantenimientos = mantenimientosFiltrados.reduce((s, m) => s + (m.costo ?? 0), 0)
  const totalRefacciones = refaccionesFiltradas.reduce((s, r) => s + r.costo, 0)

  const apodoDe = (codigo: string) => {
    const v = vehiculos.find((x) => x.codigo === codigo)
    return v?.apodo ? `${codigo} · ${v.apodo}` : codigo
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando mantenimientos..." />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-slate-700 text-white px-4 py-5 shadow flex items-center gap-3">
        <button
          onClick={() => router.push('/')}
          className="text-slate-300 hover:text-white transition-colors"
          aria-label="Volver al inicio"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Mantenimientos</h1>
          <p className="text-slate-300 text-sm mt-0.5">Preventivos, correctivos y refacciones</p>
        </div>
      </header>

      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {requiereMigracion && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800">
            ⚠️ La tabla de mantenimientos no existe todavía. Ejecuta{' '}
            <code className="font-mono text-xs bg-amber-100 px-1 rounded">mejoras_fase4_mantenimientos.sql</code>{' '}
            en el SQL editor de Supabase.
          </div>
        )}

        {/* Alertas activas */}
        {alertas.length > 0 && (
          <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-4 space-y-2">
            <p className="text-sm font-bold text-red-700">⚠️ Alertas de mantenimiento</p>
            {alertas.map(({ v, info }) => (
              <div key={v.codigo} className="text-sm text-gray-700 flex items-center justify-between gap-2">
                <span>
                  <strong>{v.codigo}</strong>
                  {v.apodo && <span className="text-gray-500"> · {v.apodo}</span>}:{' '}
                  {info.semaforo === 'vencido'
                    ? `vencido por ${Math.abs(info.faltanKm!).toLocaleString()} km`
                    : `faltan ${info.faltanKm!.toLocaleString()} km`}
                </span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${SEMAFORO_UI[info.semaforo].badge}`}>
                  {SEMAFORO_UI[info.semaforo].label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1">
          {([
            ['unidades', 'Unidades'],
            ['historial', 'Historial'],
            ['refacciones', 'Refacciones'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t ? 'bg-slate-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── TAB: UNIDADES (semáforo) ── */}
        {tab === 'unidades' && (
          <div className="space-y-3">
            {vehiculos.filter((v) => v.estado !== 'inactivo').map((v) => {
              const info = calcularSemaforo(v)
              const enTaller = mantenimientoEnTaller(v.codigo)
              const diario = kmDiario[v.codigo] ?? 0
              return (
                <div key={v.codigo} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="font-mono font-bold text-gray-900 text-sm">{v.codigo}</span>
                      {v.apodo && <span className="text-gray-600 text-sm truncate">{v.apodo}</span>}
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${SEMAFORO_UI[info.semaforo].badge}`}>
                      {SEMAFORO_UI[info.semaforo].label}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <div className="bg-gray-50 rounded-xl px-3 py-2">
                      <p className="text-gray-400">KM actual</p>
                      <p className="font-semibold text-gray-800">{v.km_actual.toLocaleString()}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl px-3 py-2">
                      <p className="text-gray-400">KM diario (últ. {MANTENIMIENTO_VENTANA_KM_DIARIO_DIAS} días)</p>
                      <p className="font-semibold text-gray-800">
                        {diario > 0 ? `~${Math.round(diario).toLocaleString()} km/día` : 'Sin datos'}
                      </p>
                    </div>
                    {info.proximoKm != null && (
                      <div className="bg-gray-50 rounded-xl px-3 py-2">
                        <p className="text-gray-400">Próximo mantenimiento</p>
                        <p className="font-semibold text-gray-800">a los {info.proximoKm.toLocaleString()} km</p>
                      </div>
                    )}
                    {info.fechaEstimada && (
                      <div className="bg-gray-50 rounded-xl px-3 py-2">
                        <p className="text-gray-400">Fecha estimada</p>
                        <p className="font-semibold text-gray-800">
                          ~{info.fechaEstimada.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    )}
                    {enTaller && (
                      <div className="bg-amber-50 rounded-xl px-3 py-2 col-span-2">
                        <p className="text-gray-500">
                          En <strong>{enTaller.lugar ?? 'taller'}</strong> desde {formatFecha(enTaller.fecha_ingreso)}{' '}
                          ({diasEnTaller(enTaller)} días) — {mantenimientoTipoLabel(enTaller.tipo)}: {enTaller.descripcion}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => abrirPrograma(v)}
                      className="flex-1 py-2 rounded-xl border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                    >
                      {v.intervalo_mantenimiento_km ? `Programa: cada ${v.intervalo_mantenimiento_km.toLocaleString()} km` : 'Configurar programa'}
                    </button>
                    {enTaller ? (
                      <button
                        onClick={() => abrirCierre(enTaller)}
                        className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors"
                      >
                        Salió del taller
                      </button>
                    ) : (
                      <button
                        onClick={() => abrirIngreso(v)}
                        disabled={requiereMigracion}
                        className="flex-1 py-2 rounded-xl bg-slate-700 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors"
                      >
                        Ingresar a taller
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── TAB: HISTORIAL ── */}
        {tab === 'historial' && (
          <div className="space-y-3">
            <Select
              label="Vehículo"
              value={filtroVehiculo}
              onChange={(e) => setFiltroVehiculo(e.target.value)}
              options={vehiculos.map((v) => ({ value: v.codigo, label: apodoDe(v.codigo) }))}
              placeholder="Todos los vehículos"
            />

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 text-sm flex items-center justify-between">
              <span className="text-gray-500">{mantenimientosFiltrados.length} mantenimiento(s)</span>
              <span className="font-semibold text-gray-800">Total: {formatMoneda(totalMantenimientos)}</span>
            </div>

            {mantenimientosFiltrados.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-gray-500 text-sm">
                Sin mantenimientos registrados.
              </div>
            ) : (
              mantenimientosFiltrados.map((m) => (
                <div key={m.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="font-mono font-bold text-gray-900 text-sm">{m.vehiculo_codigo}</span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                        {mantenimientoTipoLabel(m.tipo)}
                      </span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${MANTENIMIENTO_ESTADOS[m.estado]?.badge ?? ''}`}>
                        {MANTENIMIENTO_ESTADOS[m.estado]?.label ?? m.estado}
                      </span>
                    </div>
                    {m.estado === 'en_taller' && (
                      <button
                        onClick={() => abrirCierre(m)}
                        className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5 hover:bg-green-100 shrink-0"
                      >
                        Cerrar
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-gray-700">{m.descripcion}</p>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <p>
                      Ingreso: {formatFecha(m.fecha_ingreso)}
                      {m.fecha_salida && <> · Salida: {formatFecha(m.fecha_salida)}</>}
                      {diasEnTaller(m) != null && <> · {diasEnTaller(m)} día(s) en taller</>}
                    </p>
                    <p>
                      {m.lugar && <>Lugar: <span className="font-medium text-gray-700">{m.lugar}</span> · </>}
                      {m.km_al_ingreso != null && <>KM al ingreso: <span className="font-medium text-gray-700">{m.km_al_ingreso.toLocaleString()}</span> · </>}
                      Costo: <span className="font-medium text-gray-700">{m.costo != null ? formatMoneda(m.costo) : '—'}</span>
                      {m.factura_path && (
                        <> · <a href={getPublicUrl(m.factura_path)} target="_blank" rel="noreferrer" className="text-blue-600 underline">Factura</a></>
                      )}
                    </p>
                    {m.observaciones && <p className="italic">{m.observaciones}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── TAB: REFACCIONES ── */}
        {tab === 'refacciones' && (
          <div className="space-y-3">
            {requiereMigracionRef && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800">
                ⚠️ La tabla de refacciones no existe todavía. Ejecuta{' '}
                <code className="font-mono text-xs bg-amber-100 px-1 rounded">mejoras_fase5_refacciones.sql</code>{' '}
                en el SQL editor de Supabase.
              </div>
            )}

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Select
                  label="Vehículo"
                  value={filtroVehiculo}
                  onChange={(e) => setFiltroVehiculo(e.target.value)}
                  options={vehiculos.map((v) => ({ value: v.codigo, label: apodoDe(v.codigo) }))}
                  placeholder="Todos los vehículos"
                />
              </div>
              <button
                onClick={abrirNuevaRefaccion}
                disabled={requiereMigracionRef}
                className="py-3 px-4 rounded-xl bg-slate-700 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors shrink-0"
              >
                + Nueva
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 text-sm flex items-center justify-between">
              <span className="text-gray-500">{refaccionesFiltradas.length} refacción(es)</span>
              <span className="font-semibold text-gray-800">Total: {formatMoneda(totalRefacciones)}</span>
            </div>

            {refaccionesFiltradas.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-gray-500 text-sm">
                Sin refacciones registradas.
              </div>
            ) : (
              refaccionesFiltradas.map((r) => (
                <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        {r.nombre}
                        <span className="ml-2 font-mono font-normal text-xs text-gray-500">{r.vehiculo_codigo}</span>
                      </p>
                      <p className="text-sm text-gray-600 mt-0.5">{r.motivo}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {r.fecha_compra?.slice(0, 10)} · {formatMoneda(r.costo)}
                        {r.proveedor && <> · {r.proveedor}</>}
                        {r.km_al_momento != null && <> · {r.km_al_momento.toLocaleString()} km</>}
                        {r.mantenimiento_id && <> · Ligada a mantenimiento</>}
                        {r.factura_path && (
                          <> · <a href={getPublicUrl(r.factura_path)} target="_blank" rel="noreferrer" className="text-blue-600 underline">Factura</a></>
                        )}
                      </p>
                      {r.observaciones && <p className="text-xs text-gray-500 italic mt-1">{r.observaciones}</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => abrirEdicionRefaccion(r)} title="Editar"
                        className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:text-slate-700 hover:border-slate-300">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button onClick={() => setRefAEliminar(r)} title="Eliminar"
                        className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:text-red-600 hover:border-red-200">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* ===================================================
          MODAL: CONFIGURAR PROGRAMA PREVENTIVO
      =================================================== */}
      {programaVehiculo && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !guardandoPrograma && setProgramaVehiculo(null)} />
          <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">
              Programa preventivo · {programaVehiculo.codigo}
            </h3>
            {programaError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{programaError}</div>
            )}
            <Input
              label="Cada cuántos km toca mantenimiento"
              type="number"
              inputMode="numeric"
              value={programaIntervalo}
              onChange={(e) => setProgramaIntervalo(e.target.value)}
              placeholder="Ej: 10000"
            />
            <Input
              label="KM del último mantenimiento realizado"
              type="number"
              inputMode="numeric"
              value={programaKmUltimo}
              onChange={(e) => setProgramaKmUltimo(e.target.value)}
              placeholder={`KM actual: ${programaVehiculo.km_actual.toLocaleString()}`}
            />
            <p className="text-xs text-gray-500">
              El próximo mantenimiento se calculará como último + intervalo, y la fecha estimada
              con el km diario promedio de los últimos {MANTENIMIENTO_VENTANA_KM_DIARIO_DIAS} días.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setProgramaVehiculo(null)} disabled={guardandoPrograma}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={guardarPrograma} disabled={guardandoPrograma}
                className="flex-1 py-3 rounded-xl bg-slate-700 text-white font-semibold hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2">
                {guardandoPrograma && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          MODAL: INGRESO A TALLER
      =================================================== */}
      {ingresoVehiculo && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !guardandoIngreso && setIngresoVehiculo(null)} />
          <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">
              Ingresar a taller · {ingresoVehiculo.codigo}
            </h3>
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              La unidad quedará deshabilitada para salidas hasta registrar que salió del taller.
            </p>
            {ingresoError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{ingresoError}</div>
            )}
            <Select
              label="Tipo de mantenimiento"
              value={ingresoTipo}
              onChange={(e) => setIngresoTipo(e.target.value as MantenimientoTipo)}
              options={MANTENIMIENTO_TIPOS.map((t) => ({ value: t.value, label: t.label }))}
            />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Descripción <span className="text-red-500">*</span>
              </label>
              <textarea
                value={ingresoDescripcion}
                onChange={(e) => setIngresoDescripcion(e.target.value)}
                rows={2}
                placeholder="Ej: Servicio de 10,000 km, cambio de aceite y filtros"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <Input
              label="Lugar / taller"
              type="text"
              value={ingresoLugar}
              onChange={(e) => setIngresoLugar(e.target.value)}
              placeholder="Ej: Taller García"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="KM al dejar la unidad"
                type="number"
                inputMode="numeric"
                value={ingresoKm}
                onChange={(e) => setIngresoKm(e.target.value)}
              />
              <Input
                label="Fecha de ingreso"
                type="datetime-local"
                value={ingresoFecha}
                onChange={(e) => setIngresoFecha(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setIngresoVehiculo(null)} disabled={guardandoIngreso}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={guardarIngreso} disabled={guardandoIngreso}
                className="flex-1 py-3 rounded-xl bg-slate-700 text-white font-semibold hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2">
                {guardandoIngreso && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Ingresar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          MODAL: CIERRE DE MANTENIMIENTO
      =================================================== */}
      {cierreMantenimiento && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !guardandoCierre && setCierreMantenimiento(null)} />
          <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">
              Salida del taller · {cierreMantenimiento.vehiculo_codigo}
            </h3>
            <p className="text-sm text-gray-600">
              {mantenimientoTipoLabel(cierreMantenimiento.tipo)}: {cierreMantenimiento.descripcion}
              <br />
              En taller desde {formatFecha(cierreMantenimiento.fecha_ingreso)} ({diasEnTaller(cierreMantenimiento)} días).
            </p>
            {cierreError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{cierreError}</div>
            )}
            <Input
              label="Fecha de salida del taller"
              type="datetime-local"
              value={cierreFecha}
              onChange={(e) => setCierreFecha(e.target.value)}
            />
            <Input
              label="Costo total (MXN)"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={cierreCosto}
              onChange={(e) => setCierreCosto(e.target.value)}
              placeholder="Ej: 2500.00"
            />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Observaciones</label>
              <textarea
                value={cierreObservaciones}
                onChange={(e) => setCierreObservaciones(e.target.value)}
                rows={2}
                placeholder="Trabajos realizados, garantía, etc."
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <PhotoCapture label="Foto de factura / nota (opcional)" onPhoto={setCierreFoto} />
            {cierreMantenimiento.tipo === 'preventivo' && (
              <p className="text-xs text-gray-500">
                Al cerrar, el contador del próximo mantenimiento preventivo se reiniciará desde los{' '}
                {cierreMantenimiento.km_al_ingreso?.toLocaleString() ?? '—'} km del ingreso.
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setCierreMantenimiento(null)} disabled={guardandoCierre}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={guardarCierre} disabled={guardandoCierre}
                className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {guardandoCierre && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Registrar salida
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          MODAL: REFACCIÓN (ALTA/EDICIÓN)
      =================================================== */}
      {refaccionModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !guardandoRef && setRefaccionModal(false)} />
          <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">
              {refaccionEditando ? 'Editar refacción' : 'Nueva refacción'}
            </h3>
            {refError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{refError}</div>
            )}
            <Select
              label="Vehículo"
              value={refVehiculo}
              onChange={(e) => setRefVehiculo(e.target.value)}
              options={vehiculos.map((v) => ({ value: v.codigo, label: apodoDe(v.codigo) }))}
              placeholder="Selecciona el vehículo"
            />
            <Input
              label="Refacción"
              type="text"
              value={refNombre}
              onChange={(e) => setRefNombre(e.target.value)}
              placeholder="Ej: Balatas delanteras"
            />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Motivo de la compra <span className="text-red-500">*</span>
              </label>
              <textarea
                value={refMotivo}
                onChange={(e) => setRefMotivo(e.target.value)}
                rows={2}
                placeholder="Ej: Desgaste por uso, rechinido al frenar"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Costo (MXN)"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={refCosto}
                onChange={(e) => setRefCosto(e.target.value)}
                placeholder="Ej: 850.00"
              />
              <Input
                label="Fecha de compra"
                type="date"
                value={refFecha}
                onChange={(e) => setRefFecha(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Proveedor"
                type="text"
                value={refProveedor}
                onChange={(e) => setRefProveedor(e.target.value)}
                placeholder="Opcional"
              />
              <Input
                label="KM de la unidad"
                type="number"
                inputMode="numeric"
                value={refKm}
                onChange={(e) => setRefKm(e.target.value)}
                placeholder="Opcional"
              />
            </div>
            {refVehiculo && (
              <Select
                label="Ligar a un mantenimiento (opcional)"
                value={refMantenimientoId}
                onChange={(e) => setRefMantenimientoId(e.target.value)}
                options={mantenimientos
                  .filter((m) => m.vehiculo_codigo === refVehiculo)
                  .map((m) => ({
                    value: m.id,
                    label: `${formatFecha(m.fecha_ingreso).slice(0, 10)} · ${mantenimientoTipoLabel(m.tipo)} · ${m.descripcion.slice(0, 40)}`,
                  }))}
                placeholder="— Sin ligar —"
              />
            )}
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Observaciones</label>
              <textarea
                value={refObservaciones}
                onChange={(e) => setRefObservaciones(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <PhotoCapture label="Foto de factura / ticket (opcional)" onPhoto={setRefFoto} />
            <div className="flex gap-3">
              <button onClick={() => setRefaccionModal(false)} disabled={guardandoRef}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={guardarRefaccion} disabled={guardandoRef}
                className="flex-1 py-3 rounded-xl bg-slate-700 text-white font-semibold hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2">
                {guardandoRef && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          DIÁLOGO: ELIMINAR REFACCIÓN
      =================================================== */}
      {refAEliminar && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !eliminandoRef && setRefAEliminar(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-gray-900">Eliminar refacción</h3>
            <p className="text-sm text-gray-600">
              Se eliminará <strong>{refAEliminar.nombre}</strong> ({formatMoneda(refAEliminar.costo)}).
              Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setRefAEliminar(null)} disabled={eliminandoRef}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={eliminarRefaccion} disabled={eliminandoRef}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {eliminandoRef && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
