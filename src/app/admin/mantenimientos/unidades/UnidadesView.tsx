'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Semáforo preventivo por unidad: barra de avance hacia el próximo
// servicio (cada 10,000 km desde el km 0), programa por unidad e
// ingreso / salida de taller.

import { useState } from 'react'
import { supabase, type Vehiculo, type Mantenimiento, type MantenimientoTipo } from '@/lib/supabase'
import Loading from '@/components/common/Loading'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import PhotoCapture from '@/components/forms/PhotoCapture'
import { comprimirFoto } from '@/lib/imageCompression'
import { buildFotoMantenimientoPath, subirFotoMantenimiento } from '@/utils/storage'
import {
  MANTENIMIENTO_TIPOS,
  MANTENIMIENTO_VENTANA_KM_DIARIO_DIAS,
  MANTENIMIENTO_INTERVALO_DEFAULT_KM,
  mantenimientoTipoLabel,
} from '@/lib/constants'
import { formatFecha } from '@/utils/formatters'
import {
  useMantenimientosData,
  MantHeader,
  AvisoMigracion,
  CierreMantenimientoModal,
  SEMAFORO_UI,
  diasEnTaller,
  hoyLocalInput,
  localInputToIso,
  type Semaforo,
} from '../shared'

const ORDEN_SEMAFORO: Record<Semaforo, number> = {
  vencido: 0,
  en_taller: 1,
  proximo: 2,
  al_dia: 3,
  sin_programa: 4,
}

export default function UnidadesView() {
  const datos = useMantenimientosData()
  const {
    vehiculos, cargando, error, requiereMigracion,
    recargar, semaforoDe, mantenimientoEnTaller, kmDiario,
  } = datos

  const [busqueda, setBusqueda] = useState('')

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
  const [ingresoKmNoDisponible, setIngresoKmNoDisponible] = useState(false)
  const [ingresoFecha, setIngresoFecha] = useState('')
  const [ingresoError, setIngresoError] = useState('')
  const [guardandoIngreso, setGuardandoIngreso] = useState(false)
  // Si el vehículo ya tiene un recorrido abierto, el ingreso solo puede
  // hacerse como excepción autorizada (no cierra el recorrido)
  const [ingresoRecorridoAbierto, setIngresoRecorridoAbierto] = useState<{ id: string } | null>(null)
  const [ingresoAutorizadoPor, setIngresoAutorizadoPor] = useState('')
  const [ingresoMotivoExcepcion, setIngresoMotivoExcepcion] = useState('')
  const [cargandoAbrirIngreso, setCargandoAbrirIngreso] = useState(false)

  // Modal cierre (compartido)
  const [cierreMantenimiento, setCierreMantenimiento] = useState<Mantenimiento | null>(null)

  // Modal registrar mantenimiento ya realizado (historial, no deshabilita la unidad)
  const [pasadoVehiculo, setPasadoVehiculo] = useState<Vehiculo | null>(null)
  const [pasadoTipo, setPasadoTipo] = useState<MantenimientoTipo>('preventivo')
  const [pasadoDescripcion, setPasadoDescripcion] = useState('')
  const [pasadoLugar, setPasadoLugar] = useState('')
  const [pasadoKm, setPasadoKm] = useState('')
  const [pasadoFechaIngreso, setPasadoFechaIngreso] = useState('')
  const [pasadoFechaSalida, setPasadoFechaSalida] = useState('')
  const [pasadoCosto, setPasadoCosto] = useState('')
  const [pasadoObservaciones, setPasadoObservaciones] = useState('')
  const [pasadoFoto, setPasadoFoto] = useState<File | null>(null)
  const [pasadoError, setPasadoError] = useState('')
  const [guardandoPasado, setGuardandoPasado] = useState(false)

  function abrirPrograma(v: Vehiculo) {
    setProgramaVehiculo(v)
    setProgramaIntervalo((v.intervalo_mantenimiento_km ?? MANTENIMIENTO_INTERVALO_DEFAULT_KM).toString())
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
      await recargar()
    } catch (e: unknown) {
      setProgramaError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardandoPrograma(false)
    }
  }

  async function abrirIngreso(v: Vehiculo) {
    setIngresoVehiculo(v)
    setIngresoTipo('preventivo')
    setIngresoDescripcion('')
    setIngresoLugar('')
    setIngresoFecha(hoyLocalInput())
    setIngresoError('')
    setIngresoAutorizadoPor('')
    setIngresoMotivoExcepcion('')
    setIngresoRecorridoAbierto(null)
    setIngresoKmNoDisponible(false)
    setIngresoKm('')
    setCargandoAbrirIngreso(true)
    try {
      const { data: abierto } = await supabase
        .from('recorridos')
        .select('id')
        .eq('vehiculo_codigo', v.codigo)
        .eq('estado', 'abierto')
        .maybeSingle()
      if (abierto) {
        // Modo excepcional: no se conoce el km real de ingreso (la unidad
        // sigue en ruta), así que el campo se deja vacío a propósito en
        // vez de precargar el km_actual consolidado.
        setIngresoRecorridoAbierto(abierto as { id: string })
      } else {
        // Modo normal: el vehículo está detenido, el km_actual sí es confiable
        setIngresoKm(v.km_actual.toString())
      }
    } finally {
      setCargandoAbrirIngreso(false)
    }
  }

  async function guardarIngreso() {
    if (!ingresoVehiculo) return
    if (!ingresoDescripcion.trim()) {
      setIngresoError('Describe el mantenimiento que se realizará.')
      return
    }

    const modoExcepcional = !!ingresoRecorridoAbierto
    if (modoExcepcional) {
      if (!ingresoAutorizadoPor.trim()) {
        setIngresoError('Indica quién autoriza el ingreso excepcional.')
        return
      }
      if (!ingresoMotivoExcepcion.trim()) {
        setIngresoError('Indica el motivo de la excepción.')
        return
      }
    }

    setGuardandoIngreso(true)
    try {
      const kmNum = !modoExcepcional || !ingresoKmNoDisponible
        ? (ingresoKm ? Number(ingresoKm) : null)
        : null

      if (modoExcepcional) {
        // El recorrido pudo cerrarse entre abrir el modal y guardar: se
        // vuelve a verificar para no perder la referencia al recorrido.
        const { data: sigueAbierto } = await supabase
          .from('recorridos')
          .select('id')
          .eq('id', ingresoRecorridoAbierto!.id)
          .eq('estado', 'abierto')
          .maybeSingle()
        if (!sigueAbierto) {
          throw new Error('El recorrido que estaba abierto ya se cerró. Vuelve a intentar el ingreso normal.')
        }
      } else {
        // Un vehículo en ruta no puede entrar al taller por la vía normal
        const { data: abierto } = await supabase
          .from('recorridos')
          .select('id')
          .eq('vehiculo_codigo', ingresoVehiculo.codigo)
          .eq('estado', 'abierto')
          .maybeSingle()
        if (abierto) {
          throw new Error('Este vehículo tiene un recorrido abierto. Ciérralo antes de ingresarlo al taller, o usa el ingreso excepcional.')
        }
      }

      const { data: nuevo, error: err } = await (supabase.from('mantenimientos') as any)
        .insert({
          vehiculo_codigo: ingresoVehiculo.codigo,
          tipo: ingresoTipo,
          estado: 'en_taller',
          descripcion: ingresoDescripcion.trim(),
          lugar: ingresoLugar.trim() || null,
          km_al_ingreso: kmNum,
          fecha_ingreso: localInputToIso(ingresoFecha) ?? new Date().toISOString(),
          ...(modoExcepcional
            ? {
                ingreso_excepcional: true,
                motivo_excepcion: ingresoMotivoExcepcion.trim(),
                autorizado_por: ingresoAutorizadoPor.trim(),
                recorrido_abierto_id: ingresoRecorridoAbierto!.id,
              }
            : {}),
        })
        .select()
        .single()
      if (err) {
        // Ojo con el orden: el mensaje de columna faltante de PostgREST solo
        // reporta UNA columna (la primera que encuentra, no necesariamente
        // "ingreso_excepcional") y también incluye el nombre de la tabla
        // ("... column of 'mantenimientos' ..."), así que hay que revisar las
        // 4 columnas de fase 10 antes del aviso genérico de fase 4.
        const columnasFase10 = ['ingreso_excepcional', 'motivo_excepcion', 'autorizado_por', 'recorrido_abierto_id']
        if (modoExcepcional && columnasFase10.some((c) => err.message.includes(c))) {
          throw new Error('Ejecuta la migración mejoras_fase10_ingreso_excepcional.sql en Supabase.')
        }
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

      // Dejar rastro en el historial del recorrido: sigue abierto, pero
      // suspendido mientras la unidad está en taller
      if (modoExcepcional && nuevo) {
        await (supabase.from('recorridos_auditoria') as any).insert({
          recorrido_id: ingresoRecorridoAbierto!.id,
          accion: 'suspender_por_mantenimiento',
          realizado_por: ingresoAutorizadoPor.trim(),
          comentario: ingresoMotivoExcepcion.trim(),
          datos_nuevos: { mantenimiento_id: nuevo.id },
        })
      }

      setIngresoVehiculo(null)
      await recargar()
    } catch (e: unknown) {
      setIngresoError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardandoIngreso(false)
    }
  }

  function abrirPasado(v: Vehiculo) {
    setPasadoVehiculo(v)
    setPasadoTipo('preventivo')
    setPasadoDescripcion('')
    setPasadoLugar('')
    setPasadoKm('')
    const hoy = hoyLocalInput()
    setPasadoFechaIngreso(hoy)
    setPasadoFechaSalida(hoy)
    setPasadoCosto('')
    setPasadoObservaciones('')
    setPasadoFoto(null)
    setPasadoError('')
  }

  async function guardarPasado() {
    if (!pasadoVehiculo) return
    if (!pasadoDescripcion.trim()) {
      setPasadoError('Describe el mantenimiento que se realizó.')
      return
    }

    const ingresoIso = localInputToIso(pasadoFechaIngreso)
    const salidaIso = localInputToIso(pasadoFechaSalida)
    if (!ingresoIso || !salidaIso) {
      setPasadoError('Indica la fecha de ingreso y de salida del taller.')
      return
    }
    const ahora = Date.now()
    if (new Date(salidaIso).getTime() < new Date(ingresoIso).getTime()) {
      setPasadoError('La fecha de salida no puede ser anterior a la de ingreso.')
      return
    }
    if (new Date(ingresoIso).getTime() > ahora || new Date(salidaIso).getTime() > ahora) {
      setPasadoError('Este mantenimiento ya debe haber ocurrido: usa fecha de hoy o anterior.')
      return
    }
    const costoNum = pasadoCosto ? Number(pasadoCosto) : null
    if (pasadoCosto && (isNaN(costoNum!) || costoNum! < 0)) {
      setPasadoError('El costo no es válido.')
      return
    }

    setGuardandoPasado(true)
    try {
      const kmNum = pasadoKm ? Number(pasadoKm) : null
      const { data: nuevo, error: err } = await (supabase.from('mantenimientos') as any)
        .insert({
          vehiculo_codigo: pasadoVehiculo.codigo,
          tipo: pasadoTipo,
          estado: 'completado',
          descripcion: pasadoDescripcion.trim(),
          lugar: pasadoLugar.trim() || null,
          km_al_ingreso: kmNum,
          fecha_ingreso: ingresoIso,
          fecha_salida: salidaIso,
          costo: costoNum,
          observaciones: pasadoObservaciones.trim() || null,
        })
        .select()
        .single()
      if (err) {
        if (err.message.includes('mantenimientos')) {
          throw new Error('Ejecuta la migración mejoras_fase4_mantenimientos.sql en Supabase.')
        }
        throw new Error(err.message)
      }

      if (pasadoFoto && nuevo) {
        const comprimida = await comprimirFoto(pasadoFoto)
        const facturaPath = buildFotoMantenimientoPath(pasadoVehiculo.codigo, nuevo.id)
        await subirFotoMantenimiento(facturaPath, comprimida)
        await (supabase.from('mantenimientos') as any)
          .update({ factura_path: facturaPath })
          .eq('id', nuevo.id)
      }

      // A propósito: no se toca vehiculos.estado. Es un registro histórico,
      // no significa que la unidad esté en el taller ahora mismo (puede
      // incluso tener un recorrido abierto en este momento).

      // Si fue preventivo, actualiza la base del próximo servicio solo si
      // este km es más reciente que el ya registrado (evita retroceder el
      // programa si ya existe un mantenimiento posterior capturado).
      if (pasadoTipo === 'preventivo' && kmNum != null) {
        const kmPrevio = pasadoVehiculo.km_ultimo_mantenimiento
        if (kmPrevio == null || kmNum > kmPrevio) {
          await (supabase.from('vehiculos') as any)
            .update({ km_ultimo_mantenimiento: kmNum })
            .eq('codigo', pasadoVehiculo.codigo)
        }
      }

      setPasadoVehiculo(null)
      await recargar()
    } catch (e: unknown) {
      setPasadoError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardandoPasado(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando unidades..." />
      </div>
    )
  }

  const q = busqueda.trim().toLowerCase()
  const lista = vehiculos
    .filter((v) => v.estado !== 'inactivo')
    .filter(
      (v) =>
        !q ||
        v.codigo.toLowerCase().includes(q) ||
        (v.apodo ?? '').toLowerCase().includes(q) ||
        (v.placa ?? '').toLowerCase().includes(q)
    )
    .map((v) => ({ v, info: semaforoDe(v) }))
    .sort(
      (a, b) =>
        ORDEN_SEMAFORO[a.info.semaforo] - ORDEN_SEMAFORO[b.info.semaforo] ||
        a.v.codigo.localeCompare(b.v.codigo)
    )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <MantHeader
        titulo="Estado de unidades"
        subtitulo="Programa preventivo cada 10,000 km desde el km 0"
        backHref="/admin/mantenimientos"
      />

      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {requiereMigracion && <AvisoMigracion script="mejoras_fase4_mantenimientos.sql" />}

        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar unidad por código, apodo o placa..."
          aria-label="Buscar unidad"
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
        />

        <div className="space-y-3">
          {lista.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-gray-500 text-sm">
              Sin unidades que coincidan con la búsqueda.
            </div>
          )}
          {lista.map(({ v, info }) => {
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

                {/* Barra de avance hacia el próximo servicio */}
                {info.proximoKm != null && info.progreso != null && (
                  <div className="space-y-1">
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${SEMAFORO_UI[info.semaforo].barra}`}
                        style={{ width: `${Math.round(info.progreso * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      {info.faltanKm! > 0 ? (
                        <>
                          Faltan <strong>{info.faltanKm!.toLocaleString()} km</strong> para el servicio
                          de los {info.proximoKm.toLocaleString()} km
                          {info.fechaEstimada && (
                            <>
                              {' '}· llegará ~
                              {info.fechaEstimada.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          Vencido por <strong>{Math.abs(info.faltanKm!).toLocaleString()} km</strong>{' '}
                          (tocaba a los {info.proximoKm.toLocaleString()} km)
                        </>
                      )}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <div className="bg-gray-50 rounded-xl px-3 py-2">
                    <p className="text-gray-400">KM actual</p>
                    <p className="font-semibold text-gray-800">{v.km_actual.toLocaleString()}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl px-3 py-2">
                    <p className="text-gray-400">Ritmo (últ. {MANTENIMIENTO_VENTANA_KM_DIARIO_DIAS} días)</p>
                    <p className="font-semibold text-gray-800">
                      {diario > 0 ? `~${Math.round(diario).toLocaleString()} km/día` : 'Sin datos'}
                    </p>
                  </div>
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
                      onClick={() => setCierreMantenimiento(enTaller)}
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
                <button
                  onClick={() => abrirPasado(v)}
                  disabled={requiereMigracion}
                  className="w-full text-xs text-slate-500 hover:text-slate-700 font-medium underline underline-offset-2 disabled:opacity-50"
                >
                  + Registrar mantenimiento ya realizado (no deshabilita la unidad)
                </button>
              </div>
            )
          })}
        </div>
      </main>

      {/* ── MODAL: CONFIGURAR PROGRAMA ── */}
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
              Los servicios tocan en múltiplos del intervalo contados desde el km 0
              (10,000 · 20,000 · 30,000...). El próximo será el primer múltiplo por
              arriba del km del último mantenimiento.
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

      {/* ── MODAL: INGRESO A TALLER ── */}
      {ingresoVehiculo && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !guardandoIngreso && setIngresoVehiculo(null)} />
          <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">
              {ingresoRecorridoAbierto ? 'Ingreso excepcional a taller' : 'Ingresar a taller'} · {ingresoVehiculo.codigo}
            </h3>

            {cargandoAbrirIngreso ? (
              <Loading texto="Verificando recorrido..." />
            ) : (
              <>
                {ingresoRecorridoAbierto ? (
                  <p className="text-sm text-red-700 bg-red-50 border border-red-300 rounded-xl px-3 py-2">
                    ⚠️ Esta unidad tiene un recorrido abierto. El ingreso excepcional{' '}
                    <strong>no cerrará el recorrido</strong>: seguirá abierto (suspendido) y podrá
                    finalizarse normalmente cuando la unidad salga del taller. Solo un administrador
                    debe autorizar esto.
                  </p>
                ) : (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    La unidad quedará deshabilitada para salidas hasta registrar que salió del taller.
                    Al registrar el ingreso también se detienen los avisos de WhatsApp.
                  </p>
                )}
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

                {ingresoRecorridoAbierto && (
                  <>
                    <Input
                      label="Autorizado por"
                      type="text"
                      value={ingresoAutorizadoPor}
                      onChange={(e) => setIngresoAutorizadoPor(e.target.value)}
                      placeholder="Nombre del administrador que autoriza"
                    />
                    <div className="space-y-1">
                      <label className="block text-sm font-medium text-gray-700">
                        Motivo de la excepción <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={ingresoMotivoExcepcion}
                        onChange={(e) => setIngresoMotivoExcepcion(e.target.value)}
                        rows={2}
                        placeholder="Ej: Avería en ruta, se remolcó al taller sin poder cerrar el recorrido"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-slate-500"
                      />
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Input
                      label="KM al dejar la unidad"
                      type="number"
                      inputMode="numeric"
                      value={ingresoKm}
                      disabled={ingresoKmNoDisponible}
                      onChange={(e) => setIngresoKm(e.target.value)}
                    />
                    {ingresoRecorridoAbierto && (
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={ingresoKmNoDisponible}
                          onChange={(e) => {
                            setIngresoKmNoDisponible(e.target.checked)
                            if (e.target.checked) setIngresoKm('')
                          }}
                        />
                        Kilometraje no disponible
                      </label>
                    )}
                  </div>
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
                    className={`flex-1 py-3 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2 ${
                      ingresoRecorridoAbierto ? 'bg-red-700 hover:bg-red-800' : 'bg-slate-700 hover:bg-slate-800'
                    }`}>
                    {guardandoIngreso && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {ingresoRecorridoAbierto ? 'Ingresar excepcionalmente' : 'Ingresar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL: MANTENIMIENTO YA REALIZADO ── */}
      {pasadoVehiculo && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !guardandoPasado && setPasadoVehiculo(null)} />
          <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">
              Mantenimiento ya realizado · {pasadoVehiculo.codigo}
            </h3>
            <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              Úsalo para cargar un servicio que ya se hizo (aunque la unidad tenga
              un recorrido abierto ahora mismo). Queda en el historial como
              completado y <strong>no</strong> deshabilita la unidad.
            </p>
            {pasadoError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{pasadoError}</div>
            )}
            <Select
              label="Tipo de mantenimiento"
              value={pasadoTipo}
              onChange={(e) => setPasadoTipo(e.target.value as MantenimientoTipo)}
              options={MANTENIMIENTO_TIPOS.map((t) => ({ value: t.value, label: t.label }))}
            />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Descripción <span className="text-red-500">*</span>
              </label>
              <textarea
                value={pasadoDescripcion}
                onChange={(e) => setPasadoDescripcion(e.target.value)}
                rows={2}
                placeholder="Ej: Servicio de 10,000 km, cambio de aceite y filtros"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <Input
              label="Lugar / taller"
              type="text"
              value={pasadoLugar}
              onChange={(e) => setPasadoLugar(e.target.value)}
              placeholder="Ej: Taller García"
            />
            <Input
              label="KM al momento del servicio"
              type="number"
              inputMode="numeric"
              value={pasadoKm}
              onChange={(e) => setPasadoKm(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Fecha de ingreso"
                type="datetime-local"
                value={pasadoFechaIngreso}
                onChange={(e) => setPasadoFechaIngreso(e.target.value)}
              />
              <Input
                label="Fecha de salida"
                type="datetime-local"
                value={pasadoFechaSalida}
                onChange={(e) => setPasadoFechaSalida(e.target.value)}
              />
            </div>
            <Input
              label="Costo total (MXN)"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={pasadoCosto}
              onChange={(e) => setPasadoCosto(e.target.value)}
              placeholder="Ej: 2500.00"
            />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Observaciones</label>
              <textarea
                value={pasadoObservaciones}
                onChange={(e) => setPasadoObservaciones(e.target.value)}
                rows={2}
                placeholder="Trabajos realizados, garantía, etc."
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <PhotoCapture label="Foto de factura / nota (opcional)" onPhoto={setPasadoFoto} />
            <div className="flex gap-3">
              <button onClick={() => setPasadoVehiculo(null)} disabled={guardandoPasado}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={guardarPasado} disabled={guardandoPasado}
                className="flex-1 py-3 rounded-xl bg-slate-700 text-white font-semibold hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2">
                {guardandoPasado && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: SALIDA DEL TALLER ── */}
      {cierreMantenimiento && (
        <CierreMantenimientoModal
          mantenimiento={cierreMantenimiento}
          onClose={() => setCierreMantenimiento(null)}
          onSaved={recargar}
        />
      )}
    </div>
  )
}
