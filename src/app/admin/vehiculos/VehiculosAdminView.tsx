'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Vehiculo, CentroCosto, Conductor, VehiculoEstado } from '@/lib/supabase'
import Loading from '@/components/common/Loading'

// =========================================================
// TIPOS
// =========================================================
type FiltroEstado = 'todos' | 'activo' | 'inactivo'

interface FormData {
  codigo: string
  apodo: string
  marca: string
  modelo: string
  anio: string
  placa: string
  numero_serie: string
  capacidad_tanque_litros: string
  km_actual: string
  centro_costo_id: string
  ubicacion_default: string
  conductor_designado_id: string
}

interface UltimoEvento {
  motivo: string
  fecha: string
  tipo: 'baja' | 'reactivacion'
}

const FORM_VACIO: FormData = {
  codigo: '',
  apodo: '',
  marca: '',
  modelo: '',
  anio: '',
  placa: '',
  numero_serie: '',
  capacidad_tanque_litros: '',
  km_actual: '',
  centro_costo_id: '',
  ubicacion_default: '',
  conductor_designado_id: '',
}

// =========================================================
// COMPONENTE PRINCIPAL
// =========================================================
export default function VehiculosAdminView() {
  const router = useRouter()
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([])
  const [centrosCosto, setCentrosCosto] = useState<CentroCosto[]>([])
  const [conductores, setConductores] = useState<Pick<Conductor, 'id' | 'nombre'>[]>([])
  const [ultimosEventos, setUltimosEventos] = useState<Record<string, UltimoEvento>>({})
  const [filtro, setFiltro] = useState<FiltroEstado>('activo')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  // Modal alta/edición
  const [modalAbierto, setModalAbierto] = useState(false)
  const [modoEdicion, setModoEdicion] = useState(false)
  const [form, setForm] = useState<FormData>(FORM_VACIO)
  const [formError, setFormError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [tieneRecorridoAbierto, setTieneRecorridoAbierto] = useState(false)

  // Diálogo de baja/reactivación
  const [vehiculoToggle, setVehiculoToggle] = useState<Vehiculo | null>(null)
  const [motivo, setMotivo] = useState('')
  const [motivoError, setMotivoError] = useState('')
  const [toggling, setToggling] = useState(false)

  // -------------------------------------------------------
  // CARGA DE DATOS
  // -------------------------------------------------------
  const cargarDatos = useCallback(async () => {
    setCargando(true)
    setError('')
    try {
      const [{ data: vehs, error: errVehs }, { data: centros, error: errCentros }, { data: conds }] =
        await Promise.all([
          supabase.from('vehiculos').select('*').order('codigo'),
          supabase.from('centros_costo').select('*').eq('estado', 'activo').order('nombre'),
          supabase.from('conductores').select('id, nombre').eq('estado', 'activo').order('nombre'),
        ])

      if (errVehs) throw errVehs
      if (errCentros) throw errCentros
      setConductores((conds as Pick<Conductor, 'id' | 'nombre'>[]) ?? [])

      const listaVehs = vehs ?? []
      setVehiculos(listaVehs)
      setCentrosCosto(centros ?? [])

      // Cargar el último evento (baja o reactivación) de todos los vehículos
      const todosCodigos = listaVehs.map((v) => v.codigo)

      if (todosCodigos.length > 0) {
        const { data: eventos } = await supabase
          .from('vehiculos_bajas')
          .select('vehiculo_codigo, motivo, fecha, tipo')
          .in('vehiculo_codigo', todosCodigos)
          .order('fecha', { ascending: false })

        if (eventos) {
          const mapa: Record<string, UltimoEvento> = {}
          for (const e of eventos) {
            if (!mapa[e.vehiculo_codigo]) {
              mapa[e.vehiculo_codigo] = { motivo: e.motivo, fecha: e.fecha, tipo: e.tipo }
            }
          }
          setUltimosEventos(mapa)
        }
      } else {
        setUltimosEventos({})
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cargar datos')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // -------------------------------------------------------
  // FILTRO
  // -------------------------------------------------------
  const vehiculosFiltrados = vehiculos.filter((v) =>
    filtro === 'todos' ? true : v.estado === filtro
  )

  const conteos = {
    todos: vehiculos.length,
    activo: vehiculos.filter((v) => v.estado === 'activo').length,
    inactivo: vehiculos.filter((v) => v.estado === 'inactivo').length,
  }

  // -------------------------------------------------------
  // ABRIR FORMULARIO
  // -------------------------------------------------------
  async function abrirNuevo() {
    setFormError('')
    setModoEdicion(false)
    setTieneRecorridoAbierto(false)
    setModalAbierto(true)

    const { data } = await supabase
      .from('vehiculos')
      .select('codigo')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const siguienteCodigo = data?.codigo ? generarSiguienteCodigo(data.codigo) : ''
    setForm({ ...FORM_VACIO, codigo: siguienteCodigo })
  }

  function generarSiguienteCodigo(ultimo: string): string {
    const match = ultimo.match(/^(.*?)(\d+)$/)
    if (!match) return ''
    const prefijo = match[1]
    const num = parseInt(match[2], 10)
    const siguiente = (num + 1).toString().padStart(match[2].length, '0')
    return prefijo + siguiente
  }

  async function abrirEdicion(v: Vehiculo) {
    setForm({
      codigo: v.codigo,
      apodo: v.apodo ?? '',
      marca: v.marca ?? '',
      modelo: v.modelo ?? '',
      anio: v.anio?.toString() ?? '',
      placa: v.placa ?? '',
      numero_serie: v.numero_serie ?? '',
      capacidad_tanque_litros: v.capacidad_tanque_litros.toString(),
      km_actual: v.km_actual.toString(),
      centro_costo_id: v.centro_costo_id?.toString() ?? '',
      ubicacion_default: v.ubicacion_default ?? '',
      conductor_designado_id: v.conductor_designado_id?.toString() ?? '',
    })
    setFormError('')
    setModoEdicion(true)
    setTieneRecorridoAbierto(false)

    const { count } = await supabase
      .from('recorridos')
      .select('id', { count: 'exact', head: true })
      .eq('vehiculo_codigo', v.codigo)
      .eq('estado', 'abierto')

    setTieneRecorridoAbierto((count ?? 0) > 0)
    setModalAbierto(true)
  }

  function cerrarModal() {
    if (guardando) return
    setModalAbierto(false)
  }

  // -------------------------------------------------------
  // CAMBIO DE CAMPO
  // -------------------------------------------------------
  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: name === 'codigo' ? value.toUpperCase() : value }))
    setFormError('')
  }

  // -------------------------------------------------------
  // VALIDACIÓN
  // -------------------------------------------------------
  function validar(): string | null {
    const codigo = form.codigo.trim()
    if (!codigo) return 'El código es obligatorio.'
    if (!/^[A-Z0-9\-_]+$/.test(codigo)) return 'El código solo puede tener letras, números, guiones y guiones bajos.'

    const cap = parseFloat(form.capacidad_tanque_litros)
    if (isNaN(cap) || cap <= 0) return 'La capacidad del tanque debe ser mayor a 0.'

    const km = parseInt(form.km_actual)
    if (isNaN(km) || km < 0) return 'El kilometraje actual debe ser 0 o mayor.'

    if (form.anio) {
      const anio = parseInt(form.anio)
      if (isNaN(anio) || anio < 1980 || anio > 2100) return 'El año debe estar entre 1980 y 2100.'
    }

    return null
  }

  // -------------------------------------------------------
  // GUARDAR VEHÍCULO
  // -------------------------------------------------------
  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault()
    const err = validar()
    if (err) { setFormError(err); return }

    setGuardando(true)
    setFormError('')

    const payload: Record<string, unknown> = {
      apodo: form.apodo.trim() || null,
      marca: form.marca.trim() || null,
      modelo: form.modelo.trim() || null,
      anio: form.anio ? parseInt(form.anio) : null,
      placa: form.placa.trim() || null,
      numero_serie: form.numero_serie.trim() || null,
      capacidad_tanque_litros: parseFloat(form.capacidad_tanque_litros),
      km_actual: parseInt(form.km_actual),
      centro_costo_id: form.centro_costo_id ? parseInt(form.centro_costo_id) : null,
      ubicacion_default: form.ubicacion_default.trim() || null,
      conductor_designado_id: form.conductor_designado_id ? parseInt(form.conductor_designado_id) : null,
    }

    // Guarda el vehículo; si las columnas de resguardo aún no existen
    // (migración fase 3 pendiente), reintenta sin ellas.
    async function guardar(datos: Record<string, unknown>) {
      if (modoEdicion) {
        return supabase.from('vehiculos').update(datos).eq('codigo', form.codigo)
      }
      return supabase.from('vehiculos').insert({ ...datos, codigo: form.codigo.trim(), estado: 'activo' })
    }

    try {
      let { error } = await guardar(payload)

      if (error && (error.message.includes('ubicacion_default') || error.message.includes('conductor_designado_id'))) {
        const sinResguardo = { ...payload }
        delete sinResguardo.ubicacion_default
        delete sinResguardo.conductor_designado_id
        const retry = await guardar(sinResguardo)
        error = retry.error
        if (!error) {
          setError('Los campos de resguardo no se guardaron: ejecuta la migración mejoras_fase3_resguardo.sql en Supabase.')
        }
      }
      if (error) throw error

      setModalAbierto(false)
      await cargarDatos()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('placa')) setFormError('Ya existe un vehículo con esa placa.')
      else if (msg.includes('numero_serie')) setFormError('Ya existe un vehículo con ese número de serie.')
      else if (msg.includes('codigo') || msg.includes('duplicate') || msg.includes('unique')) setFormError('Ya existe un vehículo con ese código.')
      else setFormError(msg)
    } finally {
      setGuardando(false)
    }
  }

  // -------------------------------------------------------
  // ABRIR DIÁLOGO TOGGLE
  // -------------------------------------------------------
  function abrirToggle(v: Vehiculo) {
    setVehiculoToggle(v)
    setMotivo('')
    setMotivoError('')
  }

  // -------------------------------------------------------
  // CONFIRMAR BAJA / REACTIVACIÓN
  // -------------------------------------------------------
  async function confirmarToggle() {
    if (!vehiculoToggle) return

    const esBaja = vehiculoToggle.estado === 'activo'

    if (!motivo.trim()) {
      setMotivoError(esBaja ? 'El motivo de baja es obligatorio.' : 'El motivo de reactivación es obligatorio.')
      return
    }

    setToggling(true)
    const nuevoEstado: VehiculoEstado = esBaja ? 'inactivo' : 'activo'

    try {
      const { error: errBaja } = await supabase
        .from('vehiculos_bajas')
        .insert({
          vehiculo_codigo: vehiculoToggle.codigo,
          motivo: motivo.trim(),
          tipo: esBaja ? 'baja' : 'reactivacion',
        })
      if (errBaja) throw errBaja

      const { error: errUpdate } = await supabase
        .from('vehiculos')
        .update({ estado: nuevoEstado })
        .eq('codigo', vehiculoToggle.codigo)
      if (errUpdate) throw errUpdate

      setVehiculoToggle(null)
      await cargarDatos()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cambiar estado')
      setVehiculoToggle(null)
    } finally {
      setToggling(false)
    }
  }

  // -------------------------------------------------------
  // RENDER
  // -------------------------------------------------------
  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-blue-600 text-white px-4 py-5 shadow flex items-center gap-3">
        <button
          onClick={() => router.push('/')}
          className="text-blue-200 hover:text-white transition-colors"
          aria-label="Volver al inicio"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Vehículos</h1>
          <p className="text-blue-200 text-sm mt-0.5">Administración del catálogo</p>
        </div>
        <button
          onClick={abrirNuevo}
          className="flex items-center gap-1.5 bg-white text-blue-600 font-semibold text-sm px-3 py-2 rounded-xl hover:bg-blue-50 active:bg-blue-100 transition-colors shrink-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Nuevo
        </button>
      </header>

      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Tabs de filtro */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1">
          {(['activo', 'inactivo', 'todos'] as FiltroEstado[]).map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                filtro === f ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f === 'activo' ? 'Activos' : f === 'inactivo' ? 'Inactivos' : 'Todos'}
              <span className={`ml-1.5 text-xs ${filtro === f ? 'text-blue-200' : 'text-gray-400'}`}>
                ({conteos[f]})
              </span>
            </button>
          ))}
        </div>

        {/* Lista */}
        {vehiculosFiltrados.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-gray-500 text-sm">
            {filtro === 'activo' && 'No hay vehículos activos.'}
            {filtro === 'inactivo' && 'No hay vehículos dados de baja.'}
            {filtro === 'todos' && 'No hay vehículos registrados.'}
          </div>
        ) : (
          <div className="space-y-3">
            {vehiculosFiltrados.map((v) => (
              <VehiculoCard
                key={v.codigo}
                vehiculo={v}
                centrosCosto={centrosCosto}
                conductores={conductores}
                ultimoEvento={ultimosEventos[v.codigo] ?? null}
                onEditar={() => abrirEdicion(v)}
                onToggle={() => abrirToggle(v)}
              />
            ))}
          </div>
        )}
      </main>

      {/* ===================================================
          MODAL: FORMULARIO ALTA/EDICIÓN
      =================================================== */}
      {modalAbierto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={cerrarModal} />
          <div className="relative bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-bold text-gray-900">
                {modoEdicion ? 'Editar vehículo' : 'Alta de vehículo'}
              </h2>
              <button onClick={cerrarModal} disabled={guardando} className="text-gray-400 hover:text-gray-600 disabled:opacity-40">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleGuardar} className="px-5 py-5 space-y-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">
                  Código <span className="text-red-500">*</span>
                </label>
                <input
                  name="codigo"
                  value={form.codigo}
                  onChange={handleChange}
                  disabled={modoEdicion}
                  placeholder="Ej: VH-001"
                  className={`w-full rounded-xl border px-3 py-3 text-base uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    modoEdicion ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed' : 'border-gray-300 bg-white text-gray-900'
                  }`}
                />
                {modoEdicion && <p className="text-xs text-gray-400">El código no se puede modificar.</p>}
              </div>

              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Apodo / nombre operativo</label>
                <input
                  name="apodo"
                  value={form.apodo}
                  onChange={handleChange}
                  placeholder="Ej: La Troca, Unidad 5"
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Marca</label>
                  <input name="marca" value={form.marca} onChange={handleChange} placeholder="Ej: Ford"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Modelo</label>
                  <input name="modelo" value={form.modelo} onChange={handleChange} placeholder="Ej: F-150"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Año</label>
                  <input name="anio" type="number" value={form.anio} onChange={handleChange} placeholder="Ej: 2022" min={1980} max={2100}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Placa</label>
                  <input name="placa" value={form.placa} onChange={handleChange} placeholder="Ej: ABC-1234"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base uppercase text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Número de serie (VIN)</label>
                <input name="numero_serie" value={form.numero_serie} onChange={handleChange} placeholder="Ej: 1HGBH41JXMN109186"
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base uppercase text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">
                    Capacidad tanque (L) <span className="text-red-500">*</span>
                  </label>
                  <input name="capacidad_tanque_litros" type="number" value={form.capacidad_tanque_litros} onChange={handleChange}
                    placeholder="Ej: 70" min={1} step="0.01"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">
                    KM actual <span className="text-red-500">*</span>
                  </label>
                  <input name="km_actual" type="number" value={form.km_actual} onChange={handleChange}
                    placeholder="Ej: 45000" min={0}
                    disabled={modoEdicion && tieneRecorridoAbierto}
                    className={`w-full rounded-xl border px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      modoEdicion && tieneRecorridoAbierto
                        ? 'border-amber-300 bg-amber-50 text-gray-400 cursor-not-allowed'
                        : 'border-gray-300 bg-white text-gray-900'
                    }`} />
                  {modoEdicion && tieneRecorridoAbierto && (
                    <p className="text-xs text-amber-700 flex items-center gap-1 mt-1">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                      No se puede editar mientras el vehículo tenga un recorrido abierto. El KM se actualizará automáticamente al cerrarlo.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Centro de costo asignado</label>
                <select name="centro_costo_id" value={form.centro_costo_id} onChange={handleChange}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Sin asignar —</option>
                  {centrosCosto.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre} ({c.codigo})</option>
                  ))}
                </select>
              </div>

              {/* ── Resguardo de la unidad ── */}
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Conductor designado (resguardo)</label>
                <select name="conductor_designado_id" value={form.conductor_designado_id} onChange={handleChange}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Sin asignar —</option>
                  {conductores.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400">Se preselecciona en el formulario de salida.</p>
              </div>

              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Ubicación por defecto</label>
                <input name="ubicacion_default" value={form.ubicacion_default} onChange={handleChange}
                  placeholder="Ej: Patio central, Bodega norte"
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={cerrarModal} disabled={guardando}
                  className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold text-base hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={guardando}
                  className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold text-base hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors">
                  {guardando && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {modoEdicion ? 'Guardar cambios' : 'Dar de alta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================
          DIÁLOGO: BAJA / REACTIVACIÓN
      =================================================== */}
      {vehiculoToggle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !toggling && setVehiculoToggle(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">

            {/* Encabezado */}
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                vehiculoToggle.estado === 'activo' ? 'bg-red-100' : 'bg-green-100'
              }`}>
                {vehiculoToggle.estado === 'activo' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-base">
                  {vehiculoToggle.estado === 'activo' ? 'Dar de baja' : 'Reactivar'} vehículo
                </h3>
                <p className="text-sm text-gray-500">
                  {vehiculoToggle.apodo
                    ? `${vehiculoToggle.apodo} (${vehiculoToggle.codigo})`
                    : vehiculoToggle.codigo}
                </p>
              </div>
            </div>

            <p className="text-sm text-gray-600">
              {vehiculoToggle.estado === 'activo'
                ? 'El vehículo quedará inactivo y no aparecerá en los formularios de operación. El historial se conserva.'
                : 'El vehículo volverá a estar disponible para registrar recorridos.'}
            </p>

            {/* Campo motivo — siempre obligatorio */}
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                {vehiculoToggle.estado === 'activo' ? 'Motivo de baja' : 'Motivo de reactivación'}
                <span className="text-red-500"> *</span>
              </label>
              <textarea
                value={motivo}
                onChange={(e) => { setMotivo(e.target.value); setMotivoError('') }}
                placeholder={
                  vehiculoToggle.estado === 'activo'
                    ? 'Ej: Vehículo en taller, siniestro total, venta...'
                    : 'Ej: Salió del taller, reparación completada...'
                }
                rows={3}
                className={`w-full rounded-xl border px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  motivoError ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
                }`}
              />
              {motivoError && <p className="text-xs text-red-600">{motivoError}</p>}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setVehiculoToggle(null)}
                disabled={toggling}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarToggle}
                disabled={toggling}
                className={`flex-1 py-2.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors ${
                  vehiculoToggle.estado === 'activo'
                    ? 'bg-red-600 hover:bg-red-700 active:bg-red-800'
                    : 'bg-green-600 hover:bg-green-700 active:bg-green-800'
                }`}
              >
                {toggling && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {vehiculoToggle.estado === 'activo' ? 'Dar de baja' : 'Reactivar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =========================================================
// TARJETA DE VEHÍCULO
// =========================================================
function VehiculoCard({
  vehiculo: v,
  centrosCosto,
  conductores,
  ultimoEvento,
  onEditar,
  onToggle,
}: {
  vehiculo: Vehiculo
  centrosCosto: CentroCosto[]
  conductores: Pick<Conductor, 'id' | 'nombre'>[]
  ultimoEvento: UltimoEvento | null
  onEditar: () => void
  onToggle: () => void
}) {
  const centro = centrosCosto.find((c) => c.id === v.centro_costo_id)
  const designado = conductores.find((c) => c.id === v.conductor_designado_id)

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 ${
      v.estado === 'inactivo' ? 'border-gray-200 opacity-70' : 'border-gray-100'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-gray-900 text-sm">{v.codigo}</span>
            {v.apodo && <span className="text-gray-600 text-sm font-medium truncate">{v.apodo}</span>}
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              v.estado === 'activo'
                ? 'bg-green-100 text-green-700'
                : v.estado === 'mantenimiento'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500'
            }`}>
              {v.estado === 'activo' ? 'Activo' : v.estado === 'mantenimiento' ? 'En taller' : 'Inactivo'}
            </span>
          </div>

          {(v.marca || v.modelo || v.anio) && (
            <p className="text-sm text-gray-500 mt-0.5">
              {[v.marca, v.modelo, v.anio].filter(Boolean).join(' ')}
            </p>
          )}

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-500">
            {v.placa && <span>Placa: <span className="font-medium text-gray-700 uppercase">{v.placa}</span></span>}
            <span>KM: <span className="font-medium text-gray-700">{v.km_actual.toLocaleString('es-MX')}</span></span>
            <span>Tanque: <span className="font-medium text-gray-700">{v.capacidad_tanque_litros} L</span></span>
            {centro && <span>CC: <span className="font-medium text-gray-700">{centro.nombre}</span></span>}
            {designado && <span>Resguardo: <span className="font-medium text-gray-700">{designado.nombre}</span></span>}
            {v.ubicacion_default && <span>Ubicación: <span className="font-medium text-gray-700">{v.ubicacion_default}</span></span>}
          </div>

          {/* Último evento (baja o reactivación) */}
          {ultimoEvento && (
            <div className="mt-2 flex items-start gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-gray-500 italic leading-snug">
                <span className="not-italic font-medium text-gray-400">
                  {ultimoEvento.tipo === 'baja' ? 'Baja:' : 'Reactivación:'}
                </span>{' '}
                {ultimoEvento.motivo}
              </p>
            </div>
          )}
        </div>

        {/* Acciones */}
        <div className="flex gap-2 shrink-0">
          <button onClick={onEditar} title="Editar"
            className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-blue-600 hover:border-blue-200 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button onClick={onToggle} title={v.estado === 'activo' ? 'Dar de baja' : 'Reactivar'}
            className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors ${
              v.estado === 'activo'
                ? 'border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                : 'border-gray-200 text-gray-400 hover:bg-green-50 hover:text-green-600 hover:border-green-200'
            }`}>
            {v.estado === 'activo' ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
