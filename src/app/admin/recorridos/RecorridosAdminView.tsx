'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  supabase,
  type Conductor,
  type CentroCosto,
  type Vehiculo,
  type RecorridoConDetalle,
  type RecorridoParadaConDetalle,
} from '@/lib/supabase'
import Loading from '@/components/common/Loading'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import ConductorPicker, {
  type ConductorValue,
  CONDUCTOR_VACIO,
  conductorValido,
  resolverConductorId,
} from '@/components/forms/ConductorPicker'
import CentroCostoPicker, {
  type CentroCostoValue,
  CENTRO_COSTO_VACIO,
  centroCostoValido,
  resolverCentroCostoId,
} from '@/components/forms/CentroCostoPicker'
import { COMBUSTIBLE_NIVELES, combustibleLabel } from '@/lib/constants'
import { formatFecha } from '@/utils/formatters'
import { getPublicUrl } from '@/utils/storage'

const PAGE_SIZE = 30

// ── Helpers de fechas para inputs datetime-local ─────────
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

// Bitácora de cambios: si la tabla aún no existe (migración
// pendiente) se ignora silenciosamente.
async function registrarAuditoria(
  recorridoId: string,
  accion: string,
  datosAnteriores: Record<string, unknown> | null,
  datosNuevos: Record<string, unknown> | null,
  comentario?: string
) {
  try {
    await (supabase.from('recorridos_auditoria') as any).insert({
      recorrido_id: recorridoId,
      accion,
      datos_anteriores: datosAnteriores,
      datos_nuevos: datosNuevos,
      realizado_por: 'admin',
      comentario: comentario ?? null,
    })
  } catch {
    // tabla aún no existe — no bloquear la operación principal
  }
}

async function recalcularKmVehiculo(vehiculoCodigo: string) {
  try {
    await supabase.rpc('recalcular_km_actual', { p_vehiculo_codigo: vehiculoCodigo })
  } catch {
    // función aún no existe — el trigger GREATEST sigue operando
  }
}

// ── Formulario de edición del recorrido ──────────────────
interface RecorridoForm {
  fecha_salida: string
  km_salida: string
  combustible_salida: string
  fecha_regreso: string
  km_regreso: string
  combustible_regreso: string
}

// ── Formulario de parada ─────────────────────────────────
interface ParadaForm {
  id: string | null // null = nueva
  orden: string
  centro: CentroCostoValue
  estado: 'pendiente' | 'completada'
  fecha_parada: string
  km_parada: string
  combustible_parada: string
}

type FiltroEstado = 'todos' | 'abierto' | 'cerrado'

export default function RecorridosAdminView() {
  const router = useRouter()

  // Catálogos
  const [vehiculos, setVehiculos] = useState<Pick<Vehiculo, 'codigo' | 'apodo'>[]>([])
  const [conductores, setConductores] = useState<Pick<Conductor, 'id' | 'nombre'>[]>([])
  const [centros, setCentros] = useState<Pick<CentroCosto, 'id' | 'nombre'>[]>([])

  // Lista
  const [recorridos, setRecorridos] = useState<RecorridoConDetalle[]>([])
  const [cargando, setCargando] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState('')

  // Filtros
  const [filtroVehiculo, setFiltroVehiculo] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos')

  // Editor
  const [seleccionado, setSeleccionado] = useState<RecorridoConDetalle | null>(null)
  const [paradas, setParadas] = useState<RecorridoParadaConDetalle[]>([])
  const [cargandoParadas, setCargandoParadas] = useState(false)
  const [form, setForm] = useState<RecorridoForm | null>(null)
  const [conductorValue, setConductorValue] = useState<ConductorValue>(CONDUCTOR_VACIO)
  const [centroValue, setCentroValue] = useState<CentroCostoValue>(CENTRO_COSTO_VACIO)
  const [editorError, setEditorError] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Modal de parada
  const [paradaForm, setParadaForm] = useState<ParadaForm | null>(null)
  const [paradaError, setParadaError] = useState('')
  const [guardandoParada, setGuardandoParada] = useState(false)
  const [paradaAEliminar, setParadaAEliminar] = useState<RecorridoParadaConDetalle | null>(null)
  const [eliminando, setEliminando] = useState(false)

  // ── Carga de catálogos ─────────────────────────────────
  useEffect(() => {
    async function cargarCatalogos() {
      const [{ data: vehs }, { data: conds }, { data: cens }] = await Promise.all([
        supabase.from('vehiculos').select('codigo, apodo').order('codigo'),
        supabase.from('conductores').select('id, nombre').eq('estado', 'activo').order('nombre'),
        supabase.from('centros_costo').select('id, nombre').eq('estado', 'activo').order('nombre'),
      ])
      setVehiculos((vehs as any[]) ?? [])
      setConductores((conds as any[]) ?? [])
      setCentros((cens as any[]) ?? [])
    }
    cargarCatalogos()
  }, [])

  // ── Carga de recorridos ────────────────────────────────
  const cargarRecorridos = useCallback(
    async (append: boolean, offset: number) => {
      if (append) setCargandoMas(true)
      else setCargando(true)
      setError('')

      try {
        let query = (supabase.from('recorridos') as any)
          .select('*, conductores(id, nombre), centros_costo(id, nombre, codigo)')
          .order('fecha_salida', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1)

        if (filtroVehiculo) query = query.eq('vehiculo_codigo', filtroVehiculo)
        if (filtroEstado !== 'todos') query = query.eq('estado', filtroEstado)

        const { data, error: err } = await query
        if (err) throw err

        const lote = (data as RecorridoConDetalle[]) ?? []
        setHayMas(lote.length === PAGE_SIZE)
        setRecorridos((prev) => (append ? [...prev, ...lote] : lote))
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Error al cargar recorridos')
      } finally {
        setCargando(false)
        setCargandoMas(false)
      }
    },
    [filtroVehiculo, filtroEstado]
  )

  useEffect(() => {
    cargarRecorridos(false, 0)
  }, [cargarRecorridos])

  // ── Abrir editor ───────────────────────────────────────
  async function abrirEditor(rec: RecorridoConDetalle) {
    setSeleccionado(rec)
    setEditorError('')
    setForm({
      fecha_salida: isoToLocalInput(rec.fecha_salida),
      km_salida: String(rec.km_salida),
      combustible_salida: String(rec.combustible_salida),
      fecha_regreso: isoToLocalInput(rec.fecha_regreso),
      km_regreso: rec.km_regreso != null ? String(rec.km_regreso) : '',
      combustible_regreso: rec.combustible_regreso != null ? String(rec.combustible_regreso) : '',
    })
    setConductorValue({ mode: 'lista', conductorId: String(rec.conductor_id), nombre: '' })
    setCentroValue({ mode: 'lista', centroId: String(rec.centro_costo_id), nombre: '' })
    await cargarParadas(rec.id)
  }

  async function cargarParadas(recorridoId: string) {
    setCargandoParadas(true)
    try {
      const { data } = await (supabase.from('recorridos_paradas') as any)
        .select('*, centros_costo(id, nombre, codigo)')
        .eq('recorrido_id', recorridoId)
        .order('orden', { ascending: true })
      setParadas((data as RecorridoParadaConDetalle[]) ?? [])
    } finally {
      setCargandoParadas(false)
    }
  }

  function cerrarEditor() {
    if (guardando) return
    setSeleccionado(null)
    setForm(null)
    setParadas([])
    setParadaForm(null)
  }

  // ── Guardar cambios del recorrido ──────────────────────
  async function guardarRecorrido() {
    if (!seleccionado || !form) return
    setEditorError('')

    if (!conductorValido(conductorValue)) {
      setEditorError('Selecciona o escribe el conductor.')
      return
    }
    if (!centroCostoValido(centroValue)) {
      setEditorError('Selecciona o escribe el destino.')
      return
    }

    const kmSalida = Number(form.km_salida)
    if (!form.km_salida || isNaN(kmSalida) || kmSalida < 0) {
      setEditorError('El KM de salida no es válido.')
      return
    }
    const kmRegreso = form.km_regreso ? Number(form.km_regreso) : null
    if (kmRegreso != null && kmRegreso < kmSalida) {
      setEditorError(`El KM de regreso (${kmRegreso}) no puede ser menor al de salida (${kmSalida}).`)
      return
    }
    if (!form.fecha_salida) {
      setEditorError('La fecha de salida es obligatoria.')
      return
    }
    if (seleccionado.estado === 'cerrado' && (kmRegreso == null || !form.fecha_regreso || form.combustible_regreso === '')) {
      setEditorError('Un recorrido cerrado debe conservar fecha, KM y combustible de regreso.')
      return
    }

    setGuardando(true)
    try {
      const conductorId = await resolverConductorId(conductorValue)
      const centroId = await resolverCentroCostoId(centroValue)

      const payload: Record<string, unknown> = {
        conductor_id: conductorId,
        centro_costo_id: centroId,
        fecha_salida: localInputToIso(form.fecha_salida),
        km_salida: kmSalida,
        combustible_salida: Number(form.combustible_salida),
        fecha_regreso: localInputToIso(form.fecha_regreso),
        km_regreso: kmRegreso,
        combustible_regreso: form.combustible_regreso === '' ? null : Number(form.combustible_regreso),
      }

      const { error: err } = await (supabase.from('recorridos') as any)
        .update(payload)
        .eq('id', seleccionado.id)
      if (err) throw new Error(err.message)

      await registrarAuditoria(
        seleccionado.id,
        'editar_recorrido',
        {
          conductor_id: seleccionado.conductor_id,
          centro_costo_id: seleccionado.centro_costo_id,
          fecha_salida: seleccionado.fecha_salida,
          km_salida: seleccionado.km_salida,
          combustible_salida: seleccionado.combustible_salida,
          fecha_regreso: seleccionado.fecha_regreso,
          km_regreso: seleccionado.km_regreso,
          combustible_regreso: seleccionado.combustible_regreso,
        },
        payload
      )

      // Si se corrigieron kilometrajes, sincronizar el km del vehículo
      if (kmSalida !== seleccionado.km_salida || kmRegreso !== seleccionado.km_regreso) {
        await recalcularKmVehiculo(seleccionado.vehiculo_codigo)
      }

      cerrarEditor()
      await cargarRecorridos(false, 0)
    } catch (e: unknown) {
      setEditorError(traducirErrorBD(e))
    } finally {
      setGuardando(false)
    }
  }

  // ── Reabrir / cerrar recorrido ─────────────────────────
  async function reabrirRecorrido() {
    if (!seleccionado) return
    setEditorError('')
    setGuardando(true)
    try {
      const { data: abierto } = await supabase
        .from('recorridos')
        .select('id')
        .eq('vehiculo_codigo', seleccionado.vehiculo_codigo)
        .eq('estado', 'abierto')
        .maybeSingle()

      if (abierto) {
        throw new Error('Este vehículo ya tiene otro recorrido abierto. Ciérralo primero.')
      }

      const { error: err } = await (supabase.from('recorridos') as any)
        .update({ estado: 'abierto' })
        .eq('id', seleccionado.id)
      if (err) throw new Error(err.message)

      await registrarAuditoria(seleccionado.id, 'reabrir', { estado: 'cerrado' }, { estado: 'abierto' })
      cerrarEditor()
      await cargarRecorridos(false, 0)
    } catch (e: unknown) {
      setEditorError(traducirErrorBD(e))
    } finally {
      setGuardando(false)
    }
  }

  async function cerrarRecorridoAdmin() {
    if (!seleccionado || !form) return
    setEditorError('')

    const kmRegreso = Number(form.km_regreso)
    if (!form.km_regreso || isNaN(kmRegreso)) {
      setEditorError('Para cerrar el recorrido captura el KM de regreso.')
      return
    }
    if (form.combustible_regreso === '') {
      setEditorError('Para cerrar el recorrido selecciona el combustible de regreso.')
      return
    }

    setGuardando(true)
    try {
      const { error: err } = await (supabase.from('recorridos') as any)
        .update({
          estado: 'cerrado',
          km_regreso: kmRegreso,
          combustible_regreso: Number(form.combustible_regreso),
          fecha_regreso: localInputToIso(form.fecha_regreso) ?? new Date().toISOString(),
        })
        .eq('id', seleccionado.id)
      if (err) throw new Error(err.message)

      await registrarAuditoria(seleccionado.id, 'cerrar', { estado: 'abierto' }, { estado: 'cerrado', km_regreso: kmRegreso })
      await recalcularKmVehiculo(seleccionado.vehiculo_codigo)
      cerrarEditor()
      await cargarRecorridos(false, 0)
    } catch (e: unknown) {
      setEditorError(traducirErrorBD(e))
    } finally {
      setGuardando(false)
    }
  }

  // ── Paradas ────────────────────────────────────────────
  function abrirNuevaParada() {
    const maxOrden = paradas.reduce((m, p) => Math.max(m, p.orden), 0)
    setParadaError('')
    setParadaForm({
      id: null,
      orden: String(maxOrden + 1),
      centro: CENTRO_COSTO_VACIO,
      // En recorridos cerrados la parada retroactiva se captura ya completada
      estado: seleccionado?.estado === 'cerrado' ? 'completada' : 'pendiente',
      fecha_parada: '',
      km_parada: '',
      combustible_parada: '',
    })
  }

  function abrirEdicionParada(p: RecorridoParadaConDetalle) {
    setParadaError('')
    setParadaForm({
      id: p.id,
      orden: String(p.orden),
      centro: { mode: 'lista', centroId: String(p.centro_costo_id), nombre: '' },
      estado: p.estado,
      fecha_parada: isoToLocalInput(p.fecha_parada),
      km_parada: p.km_parada != null ? String(p.km_parada) : '',
      combustible_parada: p.combustible_parada != null ? String(p.combustible_parada) : '',
    })
  }

  async function guardarParada() {
    if (!seleccionado || !paradaForm) return
    setParadaError('')

    if (!centroCostoValido(paradaForm.centro)) {
      setParadaError('Selecciona o escribe el destino de la parada.')
      return
    }
    const orden = Number(paradaForm.orden)
    if (!paradaForm.orden || isNaN(orden) || orden < 1) {
      setParadaError('El orden debe ser un número mayor o igual a 1.')
      return
    }
    if (paradaForm.estado === 'completada') {
      if (!paradaForm.fecha_parada || !paradaForm.km_parada || paradaForm.combustible_parada === '') {
        setParadaError('Una parada completada necesita fecha, KM y nivel de combustible.')
        return
      }
    }

    setGuardandoParada(true)
    try {
      const centroId = await resolverCentroCostoId(paradaForm.centro)

      const datos: Record<string, unknown> = {
        centro_costo_id: centroId,
        estado: paradaForm.estado,
        fecha_parada: paradaForm.estado === 'completada' ? localInputToIso(paradaForm.fecha_parada) : null,
        km_parada: paradaForm.estado === 'completada' ? Number(paradaForm.km_parada) : null,
        combustible_parada:
          paradaForm.estado === 'completada' ? Number(paradaForm.combustible_parada) : null,
      }

      if (paradaForm.id) {
        // ── Edición ──
        const { error: err } = await (supabase.from('recorridos_paradas') as any)
          .update(datos)
          .eq('id', paradaForm.id)
        if (err) throw new Error(err.message)

        await registrarAuditoria(seleccionado.id, 'editar_parada', { parada_id: paradaForm.id }, datos)
      } else {
        // ── Alta: si el orden está ocupado, recorrer hacia abajo ──
        const ocupadas = paradas
          .filter((p) => p.orden >= orden)
          .sort((a, b) => b.orden - a.orden) // de mayor a menor para no chocar con el índice único

        for (const p of ocupadas) {
          const { error: errShift } = await (supabase.from('recorridos_paradas') as any)
            .update({ orden: p.orden + 1 })
            .eq('id', p.id)
          if (errShift) throw new Error(errShift.message)
        }

        const payload = { ...datos, recorrido_id: seleccionado.id, orden, origen: 'admin' }
        let { error: err } = await (supabase.from('recorridos_paradas') as any).insert(payload)

        // Compatibilidad: si la columna origen aún no existe (migración pendiente)
        if (err && err.message.includes('origen')) {
          delete (payload as Record<string, unknown>).origen
          const retry = await (supabase.from('recorridos_paradas') as any).insert(payload)
          err = retry.error
        }
        if (err) {
          if (err.message.includes('check_parada_completada_con_datos')) {
            throw new Error(
              'La base de datos exige foto en paradas completadas. Ejecuta la migración mejoras_fase1_recorridos_admin.sql para permitir capturas administrativas sin foto.'
            )
          }
          throw new Error(err.message)
        }

        // Si el recorrido no usaba paradas, activar la bandera
        if (!seleccionado.usa_paradas) {
          await (supabase.from('recorridos') as any)
            .update({ usa_paradas: true })
            .eq('id', seleccionado.id)
        }

        await registrarAuditoria(seleccionado.id, 'agregar_parada', null, payload)
      }

      if (datos.km_parada != null) {
        await recalcularKmVehiculo(seleccionado.vehiculo_codigo)
      }

      setParadaForm(null)
      await cargarParadas(seleccionado.id)
      await cargarRecorridos(false, 0)
    } catch (e: unknown) {
      setParadaError(traducirErrorBD(e))
    } finally {
      setGuardandoParada(false)
    }
  }

  async function eliminarParada() {
    if (!seleccionado || !paradaAEliminar) return
    setEliminando(true)
    try {
      const { error: err } = await (supabase.from('recorridos_paradas') as any)
        .delete()
        .eq('id', paradaAEliminar.id)
      if (err) throw new Error(err.message)

      // Renumerar las paradas siguientes (de menor a mayor para no chocar)
      const siguientes = paradas
        .filter((p) => p.orden > paradaAEliminar.orden)
        .sort((a, b) => a.orden - b.orden)

      for (const p of siguientes) {
        await (supabase.from('recorridos_paradas') as any)
          .update({ orden: p.orden - 1 })
          .eq('id', p.id)
      }

      await registrarAuditoria(seleccionado.id, 'eliminar_parada', {
        parada_id: paradaAEliminar.id,
        orden: paradaAEliminar.orden,
        centro_costo_id: paradaAEliminar.centro_costo_id,
      }, null)

      setParadaAEliminar(null)
      await cargarParadas(seleccionado.id)
    } catch (e: unknown) {
      setParadaError(traducirErrorBD(e))
      setParadaAEliminar(null)
    } finally {
      setEliminando(false)
    }
  }

  // ── Render ─────────────────────────────────────────────
  if (cargando && recorridos.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando recorridos..." />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-indigo-600 text-white px-4 py-5 shadow flex items-center gap-3">
        <button
          onClick={() => router.push('/')}
          className="text-indigo-200 hover:text-white transition-colors"
          aria-label="Volver al inicio"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Recorridos</h1>
          <p className="text-indigo-200 text-sm mt-0.5">Edición administrativa</p>
        </div>
      </header>

      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Filtros */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <Select
            label="Vehículo"
            value={filtroVehiculo}
            onChange={(e) => setFiltroVehiculo(e.target.value)}
            options={vehiculos.map((v) => ({
              value: v.codigo,
              label: v.apodo ? `${v.codigo} · ${v.apodo}` : v.codigo,
            }))}
            placeholder="Todos los vehículos"
          />
          <div className="flex gap-1 bg-gray-50 border border-gray-200 rounded-xl p-1">
            {(['todos', 'abierto', 'cerrado'] as FiltroEstado[]).map((f) => (
              <button
                key={f}
                onClick={() => setFiltroEstado(f)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filtroEstado === f ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f === 'todos' ? 'Todos' : f === 'abierto' ? 'Abiertos' : 'Cerrados'}
              </button>
            ))}
          </div>
        </div>

        {/* Lista */}
        {recorridos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-gray-500 text-sm">
            No hay recorridos con los filtros seleccionados.
          </div>
        ) : (
          <div className="space-y-3">
            {recorridos.map((r) => (
              <button
                key={r.id}
                onClick={() => abrirEditor(r)}
                className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:border-indigo-200 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="font-mono font-bold text-gray-900 text-sm">{r.vehiculo_codigo}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      r.estado === 'abierto' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {r.estado === 'abierto' ? 'Abierto' : 'Cerrado'}
                    </span>
                    {r.usa_paradas && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                        Con paradas
                      </span>
                    )}
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  {r.conductores?.nombre ?? '—'} · {r.centros_costo?.nombre ?? '—'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {formatFecha(r.fecha_salida)} · KM {r.km_salida.toLocaleString()}
                  {r.km_regreso != null && ` → ${r.km_regreso.toLocaleString()}`}
                </p>
              </button>
            ))}

            {hayMas && (
              <button
                onClick={() => cargarRecorridos(true, recorridos.length)}
                disabled={cargandoMas}
                className="w-full py-3 rounded-xl border border-gray-300 bg-white text-gray-700 font-medium text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                {cargandoMas ? 'Cargando...' : 'Cargar más'}
              </button>
            )}
          </div>
        )}
      </main>

      {/* ===================================================
          MODAL: EDITOR DE RECORRIDO
      =================================================== */}
      {seleccionado && form && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={cerrarEditor} />
          <div className="relative bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {seleccionado.vehiculo_codigo}
                  <span className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full align-middle ${
                    seleccionado.estado === 'abierto' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {seleccionado.estado === 'abierto' ? 'Abierto' : 'Cerrado'}
                  </span>
                </h2>
                <p className="text-xs text-gray-500">{formatFecha(seleccionado.fecha_salida)}</p>
              </div>
              <button onClick={cerrarEditor} disabled={guardando} className="text-gray-400 hover:text-gray-600 disabled:opacity-40">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-5 space-y-5">
              {editorError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{editorError}</div>
              )}

              <ConductorPicker conductores={conductores} value={conductorValue} onChange={setConductorValue} />
              <CentroCostoPicker centros={centros} value={centroValue} onChange={setCentroValue} />

              {/* ── Salida ── */}
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-blue-800">Salida</p>
                  {seleccionado.foto_salida_path && (
                    <a href={getPublicUrl(seleccionado.foto_salida_path)} target="_blank" rel="noreferrer"
                      className="text-xs text-blue-600 underline">Ver foto</a>
                  )}
                </div>
                <Input
                  label="Fecha y hora de salida"
                  type="datetime-local"
                  value={form.fecha_salida}
                  onChange={(e) => setForm({ ...form, fecha_salida: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="KM salida"
                    type="number"
                    inputMode="numeric"
                    value={form.km_salida}
                    onChange={(e) => setForm({ ...form, km_salida: e.target.value })}
                  />
                  <Select
                    label="Combustible"
                    value={form.combustible_salida}
                    onChange={(e) => setForm({ ...form, combustible_salida: e.target.value })}
                    options={COMBUSTIBLE_NIVELES.map((n) => ({ value: n.value, label: n.label }))}
                  />
                </div>
              </div>

              {/* ── Regreso ── */}
              <div className="bg-green-50 border border-green-100 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-green-800">Regreso</p>
                  {seleccionado.foto_regreso_path && (
                    <a href={getPublicUrl(seleccionado.foto_regreso_path)} target="_blank" rel="noreferrer"
                      className="text-xs text-green-700 underline">Ver foto</a>
                  )}
                </div>
                <Input
                  label="Fecha y hora de regreso"
                  type="datetime-local"
                  value={form.fecha_regreso}
                  onChange={(e) => setForm({ ...form, fecha_regreso: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="KM regreso"
                    type="number"
                    inputMode="numeric"
                    value={form.km_regreso}
                    onChange={(e) => setForm({ ...form, km_regreso: e.target.value })}
                  />
                  <Select
                    label="Combustible"
                    value={form.combustible_regreso}
                    onChange={(e) => setForm({ ...form, combustible_regreso: e.target.value })}
                    options={COMBUSTIBLE_NIVELES.map((n) => ({ value: n.value, label: n.label }))}
                    placeholder="— Sin registrar —"
                  />
                </div>
              </div>

              {/* ── Paradas ── */}
              <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-purple-800">Paradas intermedias</p>
                  <button
                    onClick={abrirNuevaParada}
                    className="text-xs font-semibold text-purple-700 bg-white border border-purple-200 rounded-lg px-2.5 py-1.5 hover:bg-purple-100 transition-colors"
                  >
                    + Agregar
                  </button>
                </div>

                {cargandoParadas ? (
                  <p className="text-sm text-purple-600">Cargando paradas...</p>
                ) : paradas.length === 0 ? (
                  <p className="text-sm text-purple-600">Sin paradas registradas.</p>
                ) : (
                  <div className="space-y-2">
                    {paradas.map((p) => (
                      <div key={p.id} className="bg-white rounded-xl border border-purple-100 p-3 flex items-start justify-between gap-2">
                        <div className="min-w-0 text-sm">
                          <p className="font-medium text-gray-800">
                            #{p.orden} · {p.centros_costo?.nombre ?? '—'}
                            {p.origen === 'admin' && (
                              <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 align-middle">ADMIN</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {p.estado === 'completada' ? (
                              <>
                                {p.fecha_parada ? formatFecha(p.fecha_parada) : '—'} · KM {p.km_parada?.toLocaleString() ?? '—'} · {p.combustible_parada != null ? combustibleLabel(p.combustible_parada) : '—'}
                                {p.foto_parada_path && (
                                  <> · <a href={getPublicUrl(p.foto_parada_path)} target="_blank" rel="noreferrer" className="text-purple-600 underline">Foto</a></>
                                )}
                              </>
                            ) : (
                              <span className="text-amber-600 font-medium">Pendiente</span>
                            )}
                          </p>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button onClick={() => abrirEdicionParada(p)} title="Editar parada"
                            className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:text-indigo-600 hover:border-indigo-200">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button onClick={() => setParadaAEliminar(p)} title="Eliminar parada"
                            className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:text-red-600 hover:border-red-200">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Acciones ── */}
              <div className="space-y-3 pb-2">
                <button
                  onClick={guardarRecorrido}
                  disabled={guardando}
                  className="w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                >
                  {guardando && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Guardar cambios
                </button>

                {seleccionado.estado === 'cerrado' ? (
                  <button
                    onClick={reabrirRecorrido}
                    disabled={guardando}
                    className="w-full py-3 rounded-xl border border-orange-300 text-orange-700 font-semibold hover:bg-orange-50 disabled:opacity-50 transition-colors"
                  >
                    Reabrir recorrido
                  </button>
                ) : (
                  <button
                    onClick={cerrarRecorridoAdmin}
                    disabled={guardando}
                    className="w-full py-3 rounded-xl border border-green-300 text-green-700 font-semibold hover:bg-green-50 disabled:opacity-50 transition-colors"
                  >
                    Cerrar recorrido con estos datos
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          MODAL: FORMULARIO DE PARADA
      =================================================== */}
      {paradaForm && seleccionado && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !guardandoParada && setParadaForm(null)} />
          <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">
              {paradaForm.id ? 'Editar parada' : 'Nueva parada'}
            </h3>

            {paradaError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{paradaError}</div>
            )}

            <CentroCostoPicker
              label="Destino de la parada"
              centros={centros}
              value={paradaForm.centro}
              onChange={(centro) => setParadaForm({ ...paradaForm, centro })}
            />

            {!paradaForm.id && (
              <Input
                label="Orden (posición en la ruta)"
                type="number"
                min={1}
                inputMode="numeric"
                value={paradaForm.orden}
                onChange={(e) => setParadaForm({ ...paradaForm, orden: e.target.value })}
              />
            )}

            <Select
              label="Estado"
              value={paradaForm.estado}
              onChange={(e) => setParadaForm({ ...paradaForm, estado: e.target.value as 'pendiente' | 'completada' })}
              options={[
                { value: 'pendiente', label: 'Pendiente' },
                { value: 'completada', label: 'Completada' },
              ]}
              placeholder="Selecciona estado"
            />

            {paradaForm.estado === 'completada' && (
              <>
                <Input
                  label="Fecha y hora de la parada"
                  type="datetime-local"
                  value={paradaForm.fecha_parada}
                  onChange={(e) => setParadaForm({ ...paradaForm, fecha_parada: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="KM en la parada"
                    type="number"
                    inputMode="numeric"
                    value={paradaForm.km_parada}
                    onChange={(e) => setParadaForm({ ...paradaForm, km_parada: e.target.value })}
                  />
                  <Select
                    label="Combustible"
                    value={paradaForm.combustible_parada}
                    onChange={(e) => setParadaForm({ ...paradaForm, combustible_parada: e.target.value })}
                    options={COMBUSTIBLE_NIVELES.map((n) => ({ value: n.value, label: n.label }))}
                  />
                </div>
                <p className="text-xs text-gray-500">
                  Las paradas capturadas desde administración no requieren foto (quedan marcadas como captura administrativa).
                </p>
              </>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setParadaForm(null)}
                disabled={guardandoParada}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={guardarParada}
                disabled={guardandoParada}
                className="flex-1 py-3 rounded-xl bg-purple-600 text-white font-semibold hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
              >
                {guardandoParada && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Guardar parada
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          DIÁLOGO: ELIMINAR PARADA
      =================================================== */}
      {paradaAEliminar && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !eliminando && setParadaAEliminar(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-gray-900">Eliminar parada #{paradaAEliminar.orden}</h3>
            <p className="text-sm text-gray-600">
              Se eliminará la parada <strong>{paradaAEliminar.centros_costo?.nombre}</strong> y las
              paradas siguientes se renumerarán. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setParadaAEliminar(null)}
                disabled={eliminando}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={eliminarParada}
                disabled={eliminando}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {eliminando && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Mensajes de error de los triggers de Postgres ya vienen en español;
// aquí solo se limpian prefijos técnicos comunes.
function traducirErrorBD(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('ux_recorrido_abierto_por_vehiculo')) {
    return 'Este vehículo ya tiene otro recorrido abierto.'
  }
  if (msg.includes('uq_recorrido_parada_orden')) {
    return 'Ya existe una parada con ese orden en este recorrido.'
  }
  if (msg.includes('no puede ser menor al km_actual')) {
    return `${msg} — Si estás editando un recorrido histórico, ejecuta la migración mejoras_fase1_recorridos_admin.sql en Supabase (ajusta esta validación para que solo aplique a recorridos nuevos).`
  }
  return msg
}
