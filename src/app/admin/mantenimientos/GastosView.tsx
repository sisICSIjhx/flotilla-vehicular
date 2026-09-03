'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Vista compartida para Refacciones y Otros gastos (misma tabla
// `refacciones`, separadas por la columna `categoria`): listado con
// filtros, totales y alta/edición/eliminación con evidencia.

import { useState } from 'react'
import { supabase, type Refaccion } from '@/lib/supabase'
import Loading from '@/components/common/Loading'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import ExportExcelButton from '@/components/common/ExportExcelButton'
import PhotoCapture from '@/components/forms/PhotoCapture'
import { comprimirFoto } from '@/lib/imageCompression'
import {
  buildFotoRefaccionPath,
  subirFotoMantenimiento,
  getPublicUrlMantenimiento,
} from '@/utils/storage'
import { REFACCION_CATEGORIAS, mantenimientoTipoLabel, type RefaccionCategoria } from '@/lib/constants'
import { formatFecha, formatMoneda } from '@/utils/formatters'
import {
  useMantenimientosData,
  MantHeader,
  AvisoMigracion,
  registrarAuditoriaAdmin,
  diffCampos,
  hoyDateInput,
} from './shared'
import { exportarRefaccionesGastosXlsx } from './exportRefaccionesGastos'

// Campos auditables al editar una refacción/gasto
const CAMPOS_AUDITABLES = [
  'vehiculo_codigo', 'mantenimiento_id', 'nombre', 'motivo', 'costo',
  'proveedor', 'fecha_compra', 'km_al_momento', 'factura_path', 'observaciones',
]

export default function GastosView({ categoria }: { categoria: RefaccionCategoria }) {
  const ui = REFACCION_CATEGORIAS[categoria]
  const datos = useMantenimientosData()
  const {
    vehiculos, mantenimientos, refacciones, cargando, error,
    requiereMigracionRef, requiereMigracionCategoria, requiereMigracionAuditoria,
    recargar, apodoDe,
  } = datos

  const [filtroVehiculo, setFiltroVehiculo] = useState('')
  const [busqueda, setBusqueda] = useState('')

  // Modal alta/edición
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState<Refaccion | null>(null)
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
  const [refMotivoCambio, setRefMotivoCambio] = useState('')
  const [refError, setRefError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [aEliminar, setAEliminar] = useState<Refaccion | null>(null)
  const [delMotivo, setDelMotivo] = useState('')
  const [delError, setDelError] = useState('')
  const [eliminando, setEliminando] = useState(false)

  // Sin la migración de fase 8 no hay columna categoria: todo lo
  // existente se trata como refacción y la sección de gastos queda
  // bloqueada para no mezclar datos.
  const categoriaDisponible = !requiereMigracionCategoria
  const seccionBloqueada = categoria === 'gasto' && !categoriaDisponible

  function abrirNueva() {
    setEditando(null)
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
    setRefMotivoCambio('')
    setRefError('')
    setModalAbierto(true)
  }

  function abrirEdicion(r: Refaccion) {
    setEditando(r)
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
    setRefMotivoCambio('')
    setRefError('')
    setModalAbierto(true)
  }

  async function guardar() {
    if (!refVehiculo) { setRefError('Selecciona el vehículo.'); return }
    if (!refNombre.trim()) { setRefError(`Escribe el nombre de la ${ui.label.toLowerCase()}.`); return }
    if (!refMotivo.trim()) { setRefError('Escribe el motivo de la compra.'); return }
    const costo = Number(refCosto)
    if (!refCosto || isNaN(costo) || costo < 0) { setRefError('El costo no es válido.'); return }
    if (!refFecha) { setRefError('Selecciona la fecha de compra.'); return }
    if (editando && !refMotivoCambio.trim()) {
      setRefError('Escribe el motivo del cambio (queda en el historial).')
      return
    }

    setGuardando(true)
    try {
      const id = editando?.id ?? crypto.randomUUID()

      let facturaPath: string | null = editando?.factura_path ?? null
      if (refFoto) {
        const comprimida = await comprimirFoto(refFoto)
        facturaPath = buildFotoRefaccionPath(refVehiculo, id)
        await subirFotoMantenimiento(facturaPath, comprimida)
      }

      const payload: Record<string, unknown> = {
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
      if (categoriaDisponible) payload.categoria = categoria

      let err
      if (editando) {
        const diff = diffCampos(
          editando as unknown as Record<string, unknown>,
          payload,
          CAMPOS_AUDITABLES
        )
        if (!diff.hayCambios) {
          setRefError('No hay cambios que guardar.')
          setGuardando(false)
          return
        }
        const res = await (supabase.from('refacciones') as any).update(payload).eq('id', id)
        err = res.error
        if (!err) {
          await registrarAuditoriaAdmin({
            modulo: categoria,
            registroId: id,
            vehiculoCodigo: refVehiculo,
            accion: 'edicion_admin',
            motivo: refMotivoCambio,
            antes: diff.antes,
            despues: diff.despues,
          })
        }
      } else {
        const res = await (supabase.from('refacciones') as any).insert({ ...payload, id })
        err = res.error
      }
      if (err) {
        if (err.message.includes('categoria')) {
          throw new Error('Ejecuta la migración mejoras_fase8_mantenimientos_v2.sql en Supabase para separar refacciones y gastos.')
        }
        if (err.message.includes('refacciones')) {
          throw new Error('Ejecuta la migración mejoras_fase5_refacciones.sql en Supabase.')
        }
        throw new Error(err.message)
      }

      setModalAbierto(false)
      await recargar()
    } catch (e: unknown) {
      setRefError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar() {
    if (!aEliminar) return
    if (!delMotivo.trim()) { setDelError('Escribe el motivo de la eliminación.'); return }
    setEliminando(true)
    try {
      // Soft delete: el registro queda oculto y el motivo en el historial
      const { error: err } = await (supabase.from('refacciones') as any)
        .update({ eliminado: true })
        .eq('id', aEliminar.id)
      if (err) {
        if (err.message.includes('eliminado')) {
          throw new Error('Ejecuta la migración mejoras_fase9_bucket_auditoria_admin.sql en Supabase.')
        }
        throw new Error(err.message)
      }

      await registrarAuditoriaAdmin({
        modulo: categoria,
        registroId: aEliminar.id,
        vehiculoCodigo: aEliminar.vehiculo_codigo,
        accion: 'eliminacion_admin',
        motivo: delMotivo,
        antes: {
          nombre: aEliminar.nombre,
          motivo: aEliminar.motivo,
          costo: aEliminar.costo,
          proveedor: aEliminar.proveedor,
          fecha_compra: aEliminar.fecha_compra,
          km_al_momento: aEliminar.km_al_momento,
        },
      })

      setAEliminar(null)
      setDelMotivo('')
      await recargar()
    } catch (e: unknown) {
      setDelError(e instanceof Error ? e.message : String(e))
    } finally {
      setEliminando(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto={`Cargando ${ui.labelPlural.toLowerCase()}...`} />
      </div>
    )
  }

  const q = busqueda.trim().toLowerCase()
  const filtradas = refacciones
    .filter((r) =>
      categoriaDisponible ? (r.categoria ?? 'refaccion') === categoria : categoria === 'refaccion'
    )
    .filter((r) => !filtroVehiculo || r.vehiculo_codigo === filtroVehiculo)
    .filter(
      (r) =>
        !q ||
        r.nombre.toLowerCase().includes(q) ||
        r.motivo.toLowerCase().includes(q) ||
        (r.proveedor ?? '').toLowerCase().includes(q)
    )
  const total = filtradas.reduce((s, r) => s + r.costo, 0)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <MantHeader
        titulo={ui.labelPlural}
        subtitulo={ui.descripcion}
        backHref="/admin/mantenimientos"
      />

      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {requiereMigracionRef && <AvisoMigracion script="mejoras_fase5_refacciones.sql" />}
        {!requiereMigracionRef && requiereMigracionCategoria && (
          <AvisoMigracion script="mejoras_fase8_mantenimientos_v2.sql" />
        )}
        {!requiereMigracionRef && !requiereMigracionCategoria && requiereMigracionAuditoria && (
          <AvisoMigracion script="mejoras_fase9_bucket_auditoria_admin.sql" />
        )}

        {seccionBloqueada ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-gray-500 text-sm">
            Esta sección se habilita al ejecutar la migración de fase 8
            (separa refacciones de otros gastos).
          </div>
        ) : (
          <>
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
                onClick={abrirNueva}
                disabled={requiereMigracionRef}
                className="py-3 px-4 rounded-xl bg-slate-700 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors shrink-0"
              >
                + Nueva
              </button>
            </div>

            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, motivo o proveedor..."
              aria-label="Buscar registro"
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 text-sm flex items-center justify-between">
              <span className="text-gray-500">{filtradas.length} registro(s)</span>
              <span className="font-semibold text-gray-800">Total: {formatMoneda(total)}</span>
            </div>

            <ExportExcelButton
              deshabilitado={filtradas.length === 0}
              onExport={() =>
                exportarRefaccionesGastosXlsx(categoria, filtradas, vehiculos, mantenimientos, {
                  vehiculo: filtroVehiculo,
                  busqueda,
                })
              }
            />

            {filtradas.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-gray-500 text-sm">
                Sin {ui.labelPlural.toLowerCase()} registrados.
              </div>
            ) : (
              filtradas.map((r) => (
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
                          <> · <a href={getPublicUrlMantenimiento(r.factura_path)} target="_blank" rel="noreferrer" className="text-blue-600 underline">Factura</a></>
                        )}
                      </p>
                      {r.observaciones && <p className="text-xs text-gray-500 italic mt-1">{r.observaciones}</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => abrirEdicion(r)}
                        disabled={requiereMigracionAuditoria}
                        title={requiereMigracionAuditoria ? 'Requiere la migración de fase 9' : 'Editar'}
                        className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:text-slate-700 hover:border-slate-300 disabled:opacity-40">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button onClick={() => { setAEliminar(r); setDelMotivo(''); setDelError('') }}
                        disabled={requiereMigracionAuditoria}
                        title={requiereMigracionAuditoria ? 'Requiere la migración de fase 9' : 'Eliminar'}
                        className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:text-red-600 hover:border-red-200 disabled:opacity-40">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </main>

      {/* ── MODAL: ALTA / EDICIÓN ── */}
      {modalAbierto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !guardando && setModalAbierto(false)} />
          <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">
              {editando ? `Editar ${ui.label.toLowerCase()}` : `Nueva ${ui.label.toLowerCase()}`}
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
              label={ui.label}
              type="text"
              value={refNombre}
              onChange={(e) => setRefNombre(e.target.value)}
              placeholder={categoria === 'refaccion' ? 'Ej: Balatas delanteras' : 'Ej: Extintor, tapetes, torreta'}
            />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Motivo de la compra <span className="text-red-500">*</span>
              </label>
              <textarea
                value={refMotivo}
                onChange={(e) => setRefMotivo(e.target.value)}
                rows={2}
                placeholder={categoria === 'refaccion' ? 'Ej: Desgaste por uso, rechinido al frenar' : 'Ej: Equipamiento de seguridad de la unidad'}
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
            <PhotoCapture
              label={editando?.factura_path ? 'Reemplazar foto de factura (opcional)' : 'Foto de factura / ticket (opcional)'}
              onPhoto={setRefFoto}
            />
            {editando && (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">
                  Motivo del cambio <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={refMotivoCambio}
                  onChange={(e) => setRefMotivoCambio(e.target.value)}
                  rows={2}
                  placeholder="Ej: Se capturó mal el costo"
                  className="w-full rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <p className="text-xs text-gray-400">Queda registrado en el historial de cambios.</p>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setModalAbierto(false)} disabled={guardando}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={guardar} disabled={guardando}
                className="flex-1 py-3 rounded-xl bg-slate-700 text-white font-semibold hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2">
                {guardando && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DIÁLOGO: ELIMINAR ── */}
      {aEliminar && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !eliminando && setAEliminar(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-gray-900">Eliminar {ui.label.toLowerCase()}</h3>
            <p className="text-sm text-gray-600">
              Se eliminará <strong>{aEliminar.nombre}</strong> ({formatMoneda(aEliminar.costo)}).
              El registro y el motivo quedan en el historial de cambios.
            </p>
            {delError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{delError}</div>
            )}
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Motivo de la eliminación <span className="text-red-500">*</span>
              </label>
              <textarea
                value={delMotivo}
                onChange={(e) => setDelMotivo(e.target.value)}
                rows={2}
                placeholder="Ej: Registro duplicado / capturado por error"
                className="w-full rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setAEliminar(null)} disabled={eliminando}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={eliminar} disabled={eliminando}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2">
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
