'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Conductor, type ConductorBajaTipo } from '@/lib/supabase'
import Loading from '@/components/common/Loading'

type FiltroEstado = 'todos' | 'activo' | 'inactivo'

interface FormData {
  nombre: string
  numero_empleado: string
  es_eventual: boolean
  observaciones: string
}

interface UltimoEvento {
  motivo: string
  fecha: string
  tipo: ConductorBajaTipo
}

const FORM_VACIO: FormData = {
  nombre: '',
  numero_empleado: '',
  es_eventual: false,
  observaciones: '',
}

export default function ConductoresAdminView() {
  const router = useRouter()
  const [conductores, setConductores] = useState<Conductor[]>([])
  const [ultimosEventos, setUltimosEventos] = useState<Record<number, UltimoEvento>>({})
  const [filtro, setFiltro] = useState<FiltroEstado>('activo')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  // Modal alta/edición
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState<Conductor | null>(null)
  const [form, setForm] = useState<FormData>(FORM_VACIO)
  const [formError, setFormError] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Diálogo de baja/reactivación
  const [conductorToggle, setConductorToggle] = useState<Conductor | null>(null)
  const [motivo, setMotivo] = useState('')
  const [motivoError, setMotivoError] = useState('')
  const [toggling, setToggling] = useState(false)

  const cargarDatos = useCallback(async () => {
    setCargando(true)
    setError('')
    try {
      const { data, error: err } = await supabase
        .from('conductores')
        .select('*')
        .order('nombre')
      if (err) throw err
      const lista = (data as Conductor[]) ?? []
      setConductores(lista)

      // Cargar el último evento (baja o reactivación) de todos los conductores
      const todosIds = lista.map((c) => c.id)

      if (todosIds.length > 0) {
        const { data: eventos } = await supabase
          .from('conductores_bajas')
          .select('conductor_id, motivo, fecha, tipo')
          .in('conductor_id', todosIds)
          .order('fecha', { ascending: false })

        if (eventos) {
          const mapa: Record<number, UltimoEvento> = {}
          for (const e of eventos) {
            if (!mapa[e.conductor_id]) {
              mapa[e.conductor_id] = { motivo: e.motivo, fecha: e.fecha, tipo: e.tipo }
            }
          }
          setUltimosEventos(mapa)
        }
      } else {
        setUltimosEventos({})
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cargar conductores')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  const filtrados = conductores.filter((c) => (filtro === 'todos' ? true : c.estado === filtro))
  const conteos = {
    todos: conductores.length,
    activo: conductores.filter((c) => c.estado === 'activo').length,
    inactivo: conductores.filter((c) => c.estado === 'inactivo').length,
  }

  function abrirNuevo() {
    setEditando(null)
    setForm(FORM_VACIO)
    setFormError('')
    setModalAbierto(true)
  }

  function abrirEdicion(c: Conductor) {
    setEditando(c)
    setForm({
      nombre: c.nombre,
      numero_empleado: c.numero_empleado ?? '',
      es_eventual: c.es_eventual,
      observaciones: c.observaciones ?? '',
    })
    setFormError('')
    setModalAbierto(true)
  }

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim()) {
      setFormError('El nombre es obligatorio.')
      return
    }

    setGuardando(true)
    setFormError('')

    const payload = {
      nombre: form.nombre.trim(),
      numero_empleado: form.numero_empleado.trim() || null,
      es_eventual: form.es_eventual,
      observaciones: form.observaciones.trim() || null,
    }

    try {
      if (editando) {
        const { error: err } = await (supabase.from('conductores') as any)
          .update(payload)
          .eq('id', editando.id)
        if (err) throw err
      } else {
        const { error: err } = await (supabase.from('conductores') as any)
          .insert({ ...payload, estado: 'activo', origen: 'catalogo' })
        if (err) throw err
      }
      setModalAbierto(false)
      await cargarDatos()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('numero_empleado')) setFormError('Ya existe un conductor con ese número de empleado.')
      else setFormError(msg)
    } finally {
      setGuardando(false)
    }
  }

  function abrirToggle(c: Conductor) {
    setConductorToggle(c)
    setMotivo('')
    setMotivoError('')
  }

  async function confirmarToggle() {
    if (!conductorToggle) return

    const esBaja = conductorToggle.estado === 'activo'

    if (!motivo.trim()) {
      setMotivoError(esBaja ? 'El motivo de baja es obligatorio.' : 'El motivo de reactivación es obligatorio.')
      return
    }

    setToggling(true)
    const nuevoEstado = esBaja ? 'inactivo' : 'activo'

    try {
      const { error: errBaja } = await supabase
        .from('conductores_bajas')
        .insert({
          conductor_id: conductorToggle.id,
          motivo: motivo.trim(),
          tipo: esBaja ? 'baja' : 'reactivacion',
        })
      if (errBaja) throw errBaja

      const { error: err } = await (supabase.from('conductores') as any)
        .update({ estado: nuevoEstado })
        .eq('id', conductorToggle.id)
      if (err) throw err

      setConductorToggle(null)
      await cargarDatos()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cambiar estado')
      setConductorToggle(null)
    } finally {
      setToggling(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-teal-600 text-white px-4 py-5 shadow flex items-center gap-3">
        <button
          onClick={() => router.push('/')}
          className="text-teal-200 hover:text-white transition-colors"
          aria-label="Volver al inicio"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Conductores</h1>
          <p className="text-teal-200 text-sm mt-0.5">Administración del catálogo</p>
        </div>
        <button
          onClick={abrirNuevo}
          className="flex items-center gap-1.5 bg-white text-teal-600 font-semibold text-sm px-3 py-2 rounded-xl hover:bg-teal-50 active:bg-teal-100 transition-colors shrink-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Nuevo
        </button>
      </header>

      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1">
          {(['activo', 'inactivo', 'todos'] as FiltroEstado[]).map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                filtro === f ? 'bg-teal-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f === 'activo' ? 'Activos' : f === 'inactivo' ? 'Inactivos' : 'Todos'}
              <span className={`ml-1.5 text-xs ${filtro === f ? 'text-teal-200' : 'text-gray-400'}`}>
                ({conteos[f]})
              </span>
            </button>
          ))}
        </div>

        {filtrados.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-gray-500 text-sm">
            No hay conductores con este filtro.
          </div>
        ) : (
          <div className="space-y-3">
            {filtrados.map((c) => (
              <div key={c.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${
                c.estado === 'inactivo' ? 'border-gray-200 opacity-70' : 'border-gray-100'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{c.nombre}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        c.estado === 'activo' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {c.estado === 'activo' ? 'Activo' : 'Inactivo'}
                      </span>
                      {c.es_eventual && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Eventual</span>
                      )}
                      {c.origen === 'manual' && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Captura manual</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
                      {c.numero_empleado && (
                        <span>No. empleado: <span className="font-medium text-gray-700">{c.numero_empleado}</span></span>
                      )}
                    </div>
                    {c.observaciones && (
                      <p className="text-xs text-gray-500 italic mt-1.5">{c.observaciones}</p>
                    )}
                    {ultimosEventos[c.id] && (
                      <div className="mt-2 flex items-start gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-xs text-gray-500 italic leading-snug">
                          <span className="not-italic font-medium text-gray-400">
                            {ultimosEventos[c.id].tipo === 'baja' ? 'Baja:' : 'Reactivación:'}
                          </span>{' '}
                          {ultimosEventos[c.id].motivo}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => abrirEdicion(c)} title="Editar"
                      className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-teal-600 hover:border-teal-200 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button onClick={() => abrirToggle(c)} title={c.estado === 'activo' ? 'Dar de baja' : 'Reactivar'}
                      className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors ${
                        c.estado === 'activo'
                          ? 'border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                          : 'border-gray-200 text-gray-400 hover:bg-green-50 hover:text-green-600 hover:border-green-200'
                      }`}>
                      {c.estado === 'activo' ? (
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
            ))}
          </div>
        )}
      </main>

      {/* Modal alta/edición */}
      {modalAbierto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !guardando && setModalAbierto(false)} />
          <div className="relative bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-bold text-gray-900">
                {editando ? 'Editar conductor' : 'Alta de conductor'}
              </h2>
              <button onClick={() => !guardando && setModalAbierto(false)} disabled={guardando} className="text-gray-400 hover:text-gray-600 disabled:opacity-40">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleGuardar} className="px-5 py-5 space-y-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">
                  Nombre completo <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.nombre}
                  onChange={(e) => { setForm({ ...form, nombre: e.target.value }); setFormError('') }}
                  placeholder="Ej: Juan Pérez López"
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Número de empleado / CURP</label>
                <input
                  value={form.numero_empleado}
                  onChange={(e) => { setForm({ ...form, numero_empleado: e.target.value }); setFormError('') }}
                  placeholder="Opcional"
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.es_eventual}
                  onChange={(e) => setForm({ ...form, es_eventual: e.target.checked })}
                  className="w-5 h-5 rounded accent-teal-600"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800">Conductor eventual</p>
                  <p className="text-xs text-gray-500">
                    Los eventuales no aparecen en los selects de los formularios de operación.
                  </p>
                </div>
              </label>

              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Observaciones</label>
                <textarea
                  value={form.observaciones}
                  onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
                  rows={2}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{formError}</div>
              )}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModalAbierto(false)} disabled={guardando}
                  className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold text-base hover:bg-gray-50 disabled:opacity-40 transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={guardando}
                  className="flex-1 py-3 rounded-xl bg-teal-600 text-white font-semibold text-base hover:bg-teal-700 active:bg-teal-800 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                  {guardando && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {editando ? 'Guardar cambios' : 'Dar de alta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Diálogo de baja/reactivación */}
      {conductorToggle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !toggling && setConductorToggle(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-gray-900">
              {conductorToggle.estado === 'activo' ? 'Dar de baja' : 'Reactivar'} empleado
            </h3>
            <p className="text-sm text-gray-600">
              {conductorToggle.estado === 'activo'
                ? `${conductorToggle.nombre} dejará de aparecer en los formularios. Su historial se conserva.`
                : `${conductorToggle.nombre} volverá a estar disponible en los formularios.`}
            </p>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                {conductorToggle.estado === 'activo' ? 'Motivo de baja' : 'Motivo de reactivación'}
                <span className="text-red-500"> *</span>
              </label>
              <textarea
                value={motivo}
                onChange={(e) => { setMotivo(e.target.value); setMotivoError('') }}
                placeholder={
                  conductorToggle.estado === 'activo'
                    ? 'Ej: Renuncia, término de contrato, baja disciplinaria...'
                    : 'Ej: Recontratación, regreso de permiso...'
                }
                rows={3}
                className={`w-full rounded-xl border px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 ${
                  motivoError ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
                }`}
              />
              {motivoError && <p className="text-xs text-red-600">{motivoError}</p>}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setConductorToggle(null)} disabled={toggling}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={confirmarToggle} disabled={toggling}
                className={`flex-1 py-2.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 ${
                  conductorToggle.estado === 'activo'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-600 hover:bg-green-700'
                }`}>
                {toggling && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {conductorToggle.estado === 'activo' ? 'Dar de baja' : 'Reactivar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
