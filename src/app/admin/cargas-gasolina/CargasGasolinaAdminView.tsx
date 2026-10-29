'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { combustibleLabel, COMBUSTIBLE_NIVELES } from '@/lib/constants'
import { formatFecha, formatMoneda, formatDecimal } from '@/utils/formatters'
import Loading from '@/components/common/Loading'
import { getPublicUrlCarga } from '@/utils/storage'

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
  foto_tablero_antes_path: string | null
  foto_tablero_despues_path: string | null
  foto_ticket_path: string | null
  fecha_carga: string
  recorrido_id: string | null
  observaciones: string | null
}

interface EdicionForm {
  fecha_carga: string
  km_antes: string
  combustible_antes: string
  combustible_despues: string
  litros_cargados: string
  precio_litro: string
  observaciones: string
}

function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formDesdeCarga(c: CargaRow): EdicionForm {
  return {
    fecha_carga: isoToLocalInput(c.fecha_carga),
    km_antes: String(c.km_antes),
    combustible_antes: String(c.combustible_antes),
    combustible_despues: String(c.combustible_despues),
    litros_cargados: String(c.litros_cargados),
    precio_litro: String(c.precio_litro),
    observaciones: c.observaciones ?? '',
  }
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

  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [form, setForm] = useState<EdicionForm | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [editError, setEditError] = useState('')

  const [fotoModal, setFotoModal] = useState<{ url: string; titulo: string } | null>(null)

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
            foto_tablero_antes_path,
            foto_tablero_despues_path,
            foto_ticket_path,
            created_at,
            recorrido_id,
            observaciones,
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
        foto_tablero_antes_path: r.foto_tablero_antes_path ?? null,
        foto_tablero_despues_path: r.foto_tablero_despues_path ?? null,
        foto_ticket_path: r.foto_ticket_path,
        fecha_carga: r.created_at,
        recorrido_id: r.recorrido_id,
        observaciones: r.observaciones ?? null,
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
      const { data: borradas, error: errDel } = await (supabase.from('cargas_gasolina') as any)
        .delete()
        .eq('id', id)
        .select('id')

      if (errDel) throw new Error(errDel.message)
      // Con RLS sin política de DELETE, Supabase no da error: borra 0 filas
      if (!borradas || borradas.length === 0) {
        throw new Error('No se eliminó la carga (sin permiso de borrado en la BD). Ejecuta supabase/mejoras_fase13_editar_cargas_gasolina.sql.')
      }

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

  function abrirEdicion(carga: CargaRow) {
    setConfirmandoId(null)
    setEditandoId(carga.id)
    setForm(formDesdeCarga(carga))
    setEditError('')
  }

  function cerrarEdicion() {
    setEditandoId(null)
    setForm(null)
    setEditError('')
  }

  async function guardarEdicion(carga: CargaRow) {
    if (!form) return
    setEditError('')

    const km = Number(form.km_antes)
    const litros = Number(form.litros_cargados)
    const precio = Number(form.precio_litro)

    if (!form.fecha_carga) {
      setEditError('La fecha es obligatoria.')
      return
    }
    if (form.km_antes === '' || !Number.isInteger(km) || km < 0) {
      setEditError('El KM debe ser un número entero mayor o igual a 0.')
      return
    }
    if (!(litros > 0)) {
      setEditError('Los litros deben ser mayores a 0.')
      return
    }
    if (!(precio > 0)) {
      setEditError('El precio por litro debe ser mayor a 0.')
      return
    }

    const payload = {
      created_at: new Date(form.fecha_carga).toISOString(),
      km_antes: km,
      combustible_antes: Number(form.combustible_antes),
      combustible_despues: Number(form.combustible_despues),
      litros_cargados: litros,
      precio_litro: precio,
      observaciones: form.observaciones.trim() || null,
    }

    setGuardando(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: actualizadas, error: errUpd } = await (supabase.from('cargas_gasolina') as any)
        .update(payload)
        .eq('id', carga.id)
        .select('id')

      if (errUpd) throw new Error(errUpd.message)
      // Con RLS sin política de UPDATE, Supabase no da error: actualiza 0 filas
      if (!actualizadas || actualizadas.length === 0) {
        throw new Error('No se guardaron los cambios (sin permiso de edición en la BD). Ejecuta supabase/mejoras_fase13_editar_cargas_gasolina.sql.')
      }

      setCargas(prev => prev.map(c => c.id === carga.id
        ? {
            ...c,
            fecha_carga: payload.created_at,
            km_antes: payload.km_antes,
            combustible_antes: payload.combustible_antes,
            combustible_despues: payload.combustible_despues,
            litros_cargados: payload.litros_cargados,
            precio_litro: payload.precio_litro,
            costo_total: payload.litros_cargados * payload.precio_litro,
            observaciones: payload.observaciones,
          }
        : c))
      cerrarEdicion()
      setMensajeExito('Carga actualizada correctamente.')
      setTimeout(() => setMensajeExito(''), 3000)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setGuardando(false)
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

                {carga.observaciones && (
                  <p className="text-xs text-gray-500 italic">{carga.observaciones}</p>
                )}

                {editandoId === carga.id && form ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-3">
                    <p className="text-sm font-semibold text-blue-800">Editar carga</p>

                    {/* Fotos de la carga */}
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { path: carga.foto_tablero_antes_path, etiqueta: 'Odómetro', titulo: 'Odómetro (antes)' },
                        { path: carga.foto_tablero_despues_path, etiqueta: 'Carga', titulo: 'Tablero después de la carga' },
                        { path: carga.foto_ticket_path, etiqueta: 'Ticket', titulo: 'Ticket de gasolina' },
                      ].map(f => f.path ? (
                        <button
                          key={f.etiqueta}
                          type="button"
                          onClick={() => setFotoModal({ url: getPublicUrlCarga(f.path!), titulo: `${f.titulo} — ${carga.vehiculo_codigo}` })}
                          className="text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded-lg py-2 hover:bg-blue-100 transition-colors"
                        >
                          Ver {f.etiqueta}
                        </button>
                      ) : (
                        <span
                          key={f.etiqueta}
                          className="text-xs text-gray-400 bg-white border border-gray-200 rounded-lg py-2 text-center"
                        >
                          Sin {f.etiqueta.toLowerCase()}
                        </span>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="col-span-2 text-xs text-gray-700">
                        Fecha y hora
                        <input
                          type="datetime-local"
                          value={form.fecha_carga}
                          onChange={e => setForm({ ...form, fecha_carga: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
                        />
                      </label>
                      <label className="text-xs text-gray-700">
                        KM odómetro
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          value={form.km_antes}
                          onChange={e => setForm({ ...form, km_antes: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
                        />
                      </label>
                      <label className="text-xs text-gray-700">
                        Litros
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.001"
                          value={form.litros_cargados}
                          onChange={e => setForm({ ...form, litros_cargados: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
                        />
                      </label>
                      <label className="text-xs text-gray-700">
                        Precio/L
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.001"
                          value={form.precio_litro}
                          onChange={e => setForm({ ...form, precio_litro: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
                        />
                      </label>
                      <div className="text-xs text-gray-700 flex flex-col justify-end">
                        <span>Total</span>
                        <span className="mt-1 py-1.5 font-semibold text-green-700">
                          {formatMoneda((Number(form.litros_cargados) || 0) * (Number(form.precio_litro) || 0))}
                        </span>
                      </div>
                      <label className="text-xs text-gray-700">
                        Nivel antes
                        <select
                          value={form.combustible_antes}
                          onChange={e => setForm({ ...form, combustible_antes: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
                        >
                          {COMBUSTIBLE_NIVELES.map(n => (
                            <option key={n.value} value={n.value}>{n.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-gray-700">
                        Nivel después
                        <select
                          value={form.combustible_despues}
                          onChange={e => setForm({ ...form, combustible_despues: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
                        >
                          {COMBUSTIBLE_NIVELES.map(n => (
                            <option key={n.value} value={n.value}>{n.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="col-span-2 text-xs text-gray-700">
                        Observaciones
                        <textarea
                          rows={2}
                          value={form.observaciones}
                          onChange={e => setForm({ ...form, observaciones: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
                        />
                      </label>
                    </div>

                    {editError && (
                      <p className="text-xs text-red-600">{editError}</p>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => guardarEdicion(carga)}
                        disabled={guardando}
                        className="flex-1 bg-blue-600 text-white text-sm font-semibold py-2 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {guardando ? 'Guardando...' : 'Guardar cambios'}
                      </button>
                      <button
                        onClick={cerrarEdicion}
                        disabled={guardando}
                        className="flex-1 bg-gray-200 text-gray-700 text-sm font-semibold py-2 rounded-xl hover:bg-gray-300 disabled:opacity-50 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : confirmandoId === carga.id ? (
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
                  <div className="flex gap-2">
                    <button
                      onClick={() => abrirEdicion(carga)}
                      className="flex-1 text-sm text-blue-600 font-medium border border-blue-200 rounded-xl py-2 hover:bg-blue-50 transition-colors"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => { cerrarEdicion(); setConfirmandoId(carga.id) }}
                      className="flex-1 text-sm text-red-600 font-medium border border-red-200 rounded-xl py-2 hover:bg-red-50 transition-colors"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Modal de foto */}
      {fotoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setFotoModal(null)}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
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
    </div>
  )
}
