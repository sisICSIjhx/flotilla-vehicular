'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, type Conductor, type Recorrido, type Vehiculo } from '@/lib/supabase'
import {
  TIPOS_CARGA,
  SOLICITUD_UMBRAL_SOBREMONTO,
  SOLICITUD_HORA_LIMITE,
} from '@/lib/constants'
import { formatFecha, formatMoneda } from '@/utils/formatters'
import FuelGauge from '@/components/forms/FuelGauge'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import ErrorMessage from '@/components/common/ErrorMessage'
import Loading from '@/components/common/Loading'

interface VehiculoConCentro extends Vehiculo {
  centros_costo: { id: number; nombre: string; codigo: string } | null
}

interface RecorridoActivo extends Recorrido {
  conductores: { id: number; nombre: string }
  centros_costo: { id: number; nombre: string; codigo: string }
}

interface Errores {
  conductor?: string
  km?: string
  nivel?: string
  tipo_carga?: string
  monto?: string
  observaciones?: string
}

export default function FormSolicitudCombustible() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const vehiculoCodigo = (searchParams.get('vehiculo') ?? '').toUpperCase()

  const [cargandoDatos, setCargandoDatos] = useState(true)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [vehiculo, setVehiculo] = useState<VehiculoConCentro | null>(null)
  const [recorrido, setRecorrido] = useState<RecorridoActivo | null>(null)
  const [conductores, setConductores] = useState<Conductor[]>([])
  const [precioReferencia, setPrecioReferencia] = useState<number | null>(null)

  // ── Conductor (mismo patrón que carga de gasolina) ──
  const [conductorMode, setConductorMode] = useState<'lista' | 'manual'>('lista')
  const [conductorId, setConductorId] = useState('')
  const [conductorNombre, setConductorNombre] = useState('')

  // ── Captura del operador ──
  const [km, setKm] = useState('')
  const [nivel, setNivel] = useState<number | null>(null)
  const [tipoCarga, setTipoCarga] = useState('')
  const [monto, setMonto] = useState('')
  const [observaciones, setObservaciones] = useState('')

  const [errores, setErrores] = useState<Errores>({})
  const [enviando, setEnviando] = useState(false)
  const [folio, setFolio] = useState<string | null>(null)

  // ── VA-02: modal de emergencia fuera de horario ──
  const [modalEmergencia, setModalEmergencia] = useState(false)
  const [avisoHorario, setAvisoHorario] = useState(false)

  useEffect(() => {
    if (!vehiculoCodigo) {
      setErrorGeneral('Código de vehículo no especificado.')
      setCargandoDatos(false)
      return
    }

    async function cargarDatos() {
      try {
        const [{ data: veh }, { data: rec }, { data: conds }] = await Promise.all([
          supabase
            .from('vehiculos')
            .select('*, centros_costo(id, nombre, codigo)')
            .eq('codigo', vehiculoCodigo)
            .maybeSingle(),
          supabase
            .from('recorridos')
            .select('*, conductores(id, nombre), centros_costo(id, nombre, codigo)')
            .eq('vehiculo_codigo', vehiculoCodigo)
            .eq('estado', 'abierto')
            .maybeSingle(),
          supabase
            .from('conductores')
            .select('id, nombre, numero_empleado, estado, origen, es_eventual, observaciones, created_at, updated_at')
            .eq('estado', 'activo')
            .eq('es_eventual', false)
            .order('nombre'),
        ])

        if (!veh) {
          setErrorGeneral('Vehículo no encontrado.')
          return
        }
        setVehiculo(veh as VehiculoConCentro)
        setConductores((conds ?? []) as Conductor[])

        const recorridoActivo = rec as RecorridoActivo | null
        if (recorridoActivo) {
          setRecorrido(recorridoActivo)
          // Preseleccionar el conductor del recorrido; puede cambiarse
          setConductorId(String(recorridoActivo.conductor_id))
        }

        // Precio de referencia: última carga de gasolina del vehículo
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: carga } = await (supabase.from('cargas_gasolina') as any)
          .select('precio_litro')
          .eq('vehiculo_codigo', vehiculoCodigo)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (carga?.precio_litro) setPrecioReferencia(Number(carga.precio_litro))
      } catch {
        setErrorGeneral('Error al cargar los datos. Intenta de nuevo.')
      } finally {
        setCargandoDatos(false)
      }
    }

    cargarDatos()
  }, [vehiculoCodigo])

  // Monto sugerido: litros faltantes para llenar * último precio conocido
  const montoSugerido = useMemo(() => {
    if (!vehiculo || nivel === null || precioReferencia === null) return null
    const litrosFaltantes = vehiculo.capacidad_tanque_litros * (1 - nivel / 8)
    if (litrosFaltantes <= 0) return 0
    return Math.round(litrosFaltantes * precioReferencia * 100) / 100
  }, [vehiculo, nivel, precioReferencia])

  const requiereJustificacion =
    montoSugerido !== null &&
    montoSugerido > 0 &&
    Number(monto) > montoSugerido * SOLICITUD_UMBRAL_SOBREMONTO

  // Proyecto/centro de costo y destino: del recorrido activo si existe,
  // si no, del centro de costo asignado al vehículo
  const centroCostoNombre =
    recorrido?.centros_costo?.nombre ?? vehiculo?.centros_costo?.nombre ?? null

  function validar(): boolean {
    const errs: Errores = {}
    const kmNum = Number(km)

    if (conductorMode === 'lista' && !conductorId) {
      errs.conductor = 'Selecciona un conductor'
    } else if (conductorMode === 'manual' && !conductorNombre.trim()) {
      errs.conductor = 'Escribe el nombre del conductor'
    }

    if (!km || Number.isNaN(kmNum) || kmNum < 0) {
      errs.km = 'Ingresa el kilometraje actual (no puede ser negativo)'
    } else if (recorrido && kmNum < recorrido.km_salida) {
      errs.km = `El kilometraje no puede ser menor al de salida del recorrido activo (${recorrido.km_salida.toLocaleString()})`
    }

    if (nivel === null) errs.nivel = 'Selecciona el nivel de combustible'
    if (!tipoCarga) errs.tipo_carga = 'Selecciona el tipo de carga'
    if (!monto || Number(monto) <= 0) errs.monto = 'El monto debe ser mayor a 0'

    if (observaciones.length > 500) {
      errs.observaciones = 'Máximo 500 caracteres'
    } else if (requiereJustificacion && observaciones.trim().length < 10) {
      errs.observaciones = `El monto supera en más de 30% al sugerido (${formatMoneda(montoSugerido ?? 0)}). Justifica el motivo (mínimo 10 caracteres).`
    }

    setErrores(errs)
    return Object.keys(errs).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validar()) return

    // VA-02: después de la hora límite preguntar si es emergencia
    if (new Date().getHours() >= SOLICITUD_HORA_LIMITE) {
      setModalEmergencia(true)
      return
    }
    guardar(false, false)
  }

  async function guardar(fueraHorario: boolean, emergencia: boolean) {
    if (!vehiculo) return
    setEnviando(true)
    setErrorGeneral(null)

    try {
      // Resolver conductor (mismo patrón que carga de gasolina)
      let conductorIdFinal: number
      let conductorNombreFinal: string
      if (conductorMode === 'lista') {
        conductorIdFinal = Number(conductorId)
        conductorNombreFinal =
          conductores.find((c) => c.id === conductorIdFinal)?.nombre ??
          recorrido?.conductores?.nombre ??
          ''
      } else {
        const { data, error } = await supabase.rpc('get_or_create_conductor', {
          p_nombre: conductorNombre.trim(),
        })
        if (error) throw new Error(error.message)
        conductorIdFinal = data as number
        conductorNombreFinal = conductorNombre.trim()
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('solicitudes_combustible') as any)
        .insert({
          recorrido_id: recorrido?.id ?? null,
          vehiculo_codigo: vehiculo.codigo,
          conductor_id: conductorIdFinal,
          centro_costo_id: recorrido?.centro_costo_id ?? vehiculo.centro_costo_id ?? null,
          placa: vehiculo.placa,
          solicitado_por: conductorNombreFinal || null,
          destino: centroCostoNombre,
          km_solicitud: Number(km),
          combustible_nivel: nivel,
          tipo_carga: tipoCarga,
          monto_solicitado: Number(monto),
          monto_sugerido: montoSugerido,
          observaciones: observaciones.trim() || null,
          fuera_horario: fueraHorario,
          emergencia,
        })
        .select('folio')
        .single()

      if (error) throw new Error(error.message)
      setFolio(data?.folio ?? '')
      setTimeout(() => router.push(`/vehiculo/${vehiculo.codigo}`), 3500)
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : 'Error al guardar. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  function responderEmergencia(esEmergencia: boolean) {
    setModalEmergencia(false)
    if (!esEmergencia) {
      setAvisoHorario(true)
      // El aviso se muestra 2.5s y luego se registra como pendiente fuera de horario
      setTimeout(() => {
        setAvisoHorario(false)
        guardar(true, false)
      }, 2500)
    } else {
      guardar(true, true)
    }
  }

  if (cargandoDatos) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando datos..." />
      </div>
    )
  }

  if (folio !== null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <span className="text-6xl">⛽</span>
        <p className="text-xl font-bold text-gray-800">Solicitud enviada</p>
        {folio && (
          <p className="text-2xl font-mono font-bold text-orange-600">{folio}</p>
        )}
        <p className="text-gray-500 text-center max-w-xs">
          Tu solicitud quedó <strong>pendiente de autorización</strong>. El responsable fue
          notificado y podrás ver el resultado en la pantalla del vehículo.
        </p>
      </div>
    )
  }

  if (!vehiculo) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="bg-orange-600 text-white px-4 py-5 shadow">
          <button onClick={() => router.back()} className="text-orange-200 text-sm mb-2">
            ← Volver
          </button>
          <h1 className="text-xl font-bold">Solicitar Combustible</h1>
        </header>
        <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
          <ErrorMessage mensaje={errorGeneral ?? 'Vehículo no encontrado.'} />
        </main>
      </div>
    )
  }

  const ahora = new Date()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-orange-600 text-white px-4 py-5 shadow">
        <button onClick={() => router.back()} className="text-orange-200 text-sm mb-2">
          ← Volver
        </button>
        <h1 className="text-xl font-bold">Solicitar Combustible</h1>
        <p className="text-orange-200 text-sm">Vehículo: {vehiculoCodigo}</p>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 px-4 py-6 max-w-md mx-auto w-full space-y-5">
        {errorGeneral && <ErrorMessage mensaje={errorGeneral} />}

        {/* ── Datos de la unidad (informativos) ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-2 text-sm">
          <p className="font-semibold text-gray-700">Datos de la unidad</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-gray-500">Unidad</p>
              <p className="font-semibold text-gray-800">
                {vehiculo.codigo}{vehiculo.apodo ? ` · ${vehiculo.apodo}` : ''}
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-gray-500">Placas</p>
              <p className="font-semibold text-gray-800">{vehiculo.placa ?? 'N/A'}</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-gray-500">Proyecto / C. costo</p>
              <p className="font-semibold text-gray-800">{centroCostoNombre ?? 'N/A'}</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-gray-500">Fecha y hora</p>
              <p className="font-semibold text-gray-800">{formatFecha(ahora.toISOString())}</p>
            </div>
          </div>
          {recorrido ? (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              Recorrido activo desde {formatFecha(recorrido.fecha_salida)} · KM salida:{' '}
              {recorrido.km_salida.toLocaleString()} · Destino: {recorrido.centros_costo?.nombre ?? 'N/A'}.
              La solicitud quedará vinculada a este recorrido.
            </p>
          ) : (
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              Sin recorrido activo — la solicitud se registrará sin vincular a un recorrido.
            </p>
          )}
        </div>

        {/* ── Captura del operador ── */}
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 space-y-4">
          <p className="text-sm font-semibold text-orange-800">Datos de la solicitud</p>

          {/* ── Conductor (dropdown de empleados) ── */}
          <div className="space-y-1">
            {conductorMode === 'lista' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Conductor</label>
                <select
                  value={conductorId}
                  onChange={(e) => setConductorId(e.target.value)}
                  className={`w-full rounded-xl border px-3 py-3 text-base text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                    errores.conductor ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                >
                  <option value="">Selecciona el conductor</option>
                  {conductores.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
                {errores.conductor && <p className="text-sm text-red-600 mt-1">{errores.conductor}</p>}
              </div>
            ) : (
              <Input
                label="Conductor"
                type="text"
                value={conductorNombre}
                onChange={(e) => setConductorNombre(e.target.value)}
                placeholder="Escribe el nombre completo"
                error={errores.conductor}
              />
            )}
            <button
              type="button"
              onClick={() => {
                setConductorMode((m) => (m === 'lista' ? 'manual' : 'lista'))
                setConductorId('')
                setConductorNombre('')
              }}
              className="text-xs text-orange-600 hover:text-orange-800"
            >
              {conductorMode === 'lista' ? '¿No está en la lista? Escribir nombre' : 'Seleccionar de la lista'}
            </button>
          </div>

          <Input
            label="Kilometraje actual"
            type="number"
            min={0}
            value={km}
            onChange={(e) => setKm(e.target.value)}
            placeholder={`Ej: ${Math.max(vehiculo.km_actual, recorrido?.km_salida ?? 0).toLocaleString()}`}
            inputMode="numeric"
            error={errores.km}
          />
          {!recorrido && km && Number(km) >= 0 && Number(km) < vehiculo.km_actual && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              El KM ingresado es menor al registrado en el sistema ({vehiculo.km_actual.toLocaleString()}).
              Verifica el odómetro antes de enviar.
            </p>
          )}

          <FuelGauge
            label="Nivel de combustible"
            value={nivel}
            onChange={setNivel}
            error={errores.nivel}
          />

          <Select
            label="Tipo de carga"
            value={tipoCarga}
            onChange={(e) => setTipoCarga(e.target.value)}
            options={TIPOS_CARGA.map((t) => ({ value: t.value, label: t.label }))}
            placeholder="Selecciona el tipo de carga"
            error={errores.tipo_carga}
          />

          <Input
            label="Monto solicitado ($)"
            type="number"
            min={0}
            step="0.01"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="Ej: 800.00"
            inputMode="decimal"
            error={errores.monto}
          />

          {montoSugerido !== null && montoSugerido > 0 && (
            <p className="text-xs text-orange-700 bg-orange-100 rounded-lg px-3 py-2">
              Monto sugerido para llenar el tanque: <strong>{formatMoneda(montoSugerido)}</strong>{' '}
              (según el último precio por litro registrado)
            </p>
          )}
          {requiereJustificacion && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              El monto supera en más de 30% al sugerido. Justifica el motivo en observaciones.
            </p>
          )}

          <div className="space-y-1">
            <label htmlFor="observaciones" className="block text-sm font-medium text-gray-700">
              Observaciones {requiereJustificacion ? '(justificación obligatoria)' : '(opcional)'}
            </label>
            <textarea
              id="observaciones"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value.slice(0, 500))}
              rows={3}
              maxLength={500}
              placeholder="Comentarios adicionales..."
              className={`w-full rounded-xl border px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                errores.observaciones ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-white'
              }`}
            />
            <div className="flex justify-between">
              {errores.observaciones ? (
                <p className="text-sm text-red-600">{errores.observaciones}</p>
              ) : (
                <span />
              )}
              <p className="text-xs text-gray-400">{observaciones.length}/500</p>
            </div>
          </div>
        </div>

        <div className="pt-2 pb-8">
          <Button
            type="submit"
            loading={enviando}
            className="!bg-orange-600 hover:!bg-orange-700 active:!bg-orange-800"
          >
            Enviar solicitud
          </Button>
        </div>
      </form>

      {/* ── Modal VA-02: emergencia fuera de horario ── */}
      {modalEmergencia && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center px-4 z-50">
          <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-sm space-y-4">
            <span className="text-4xl block text-center">🌙</span>
            <p className="font-semibold text-gray-800 text-center">
              ¿La solicitud corresponde a una emergencia?
            </p>
            <p className="text-sm text-gray-500 text-center">
              Son más de las {SOLICITUD_HORA_LIMITE}:00 horas.
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => responderEmergencia(false)}>
                No
              </Button>
              <Button variant="danger" onClick={() => responderEmergencia(true)}>
                Sí
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Aviso: será atendida en horario laboral ── */}
      {avisoHorario && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center px-4 z-50">
          <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-sm space-y-3 text-center">
            <span className="text-4xl block">🕗</span>
            <p className="font-semibold text-gray-800">
              La solicitud será atendida en horario laboral.
            </p>
            <p className="text-sm text-gray-500">Registrando solicitud...</p>
          </div>
        </div>
      )}
    </div>
  )
}
