'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, type CentroCosto, type Conductor } from '@/lib/supabase'
import { comprimirFoto } from '@/lib/imageCompression'
import { COMBUSTIBLE_NIVELES } from '@/lib/constants'
import { buildFotoPath, subirFoto } from '@/utils/storage'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import PhotoCapture from '@/components/forms/PhotoCapture'
import ErrorMessage from '@/components/common/ErrorMessage'
import Loading from '@/components/common/Loading'

// Cada parada puede elegir de la lista o escribir un nombre libre
interface ParadaConfig {
  mode: 'lista' | 'manual'
  centroId: string  // cuando mode = 'lista'
  nombre: string    // cuando mode = 'manual'
}

interface Errores {
  conductor?: string
  centro_costo?: string
  km_salida?: string
  combustible?: string
  foto?: string
  paradas?: string
}

// Resuelve el ID de un centro de costo:
// si viene de la lista devuelve el número directamente,
// si es manual llama a la función RPC que crea el registro temporal.
async function resolverCentroCostoId(config: { mode: 'lista' | 'manual'; centroId: string; nombre: string }): Promise<number> {
  if (config.mode === 'lista') return Number(config.centroId)
  const { data, error } = await supabase.rpc('get_or_create_centro_costo', { p_nombre: config.nombre.trim() })
  if (error) throw new Error(error.message)
  return data as number
}

export default function FormSalida() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const vehiculoCodigo = searchParams.get('vehiculo') ?? ''

  const [conductores, setConductores] = useState<Conductor[]>([])
  const [centrosCosto, setCentrosCosto] = useState<CentroCosto[]>([])
  const [cargandoDatos, setCargandoDatos] = useState(true)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [kmBase, setKmBase] = useState<number>(0)

  // ── Conductor ──────────────────────────────────────
  const [conductorMode, setConductorMode] = useState<'lista' | 'manual'>('lista')
  const [conductorId, setConductorId] = useState('')
  const [conductorNombre, setConductorNombre] = useState('')

  // ── Centro de costo principal ──────────────────────
  const [centroCostoMode, setCentroCostoMode] = useState<'lista' | 'manual'>('lista')
  const [centroCostoId, setCentroCostoId] = useState('')
  const [centroCostoNombre, setCentroCostoNombre] = useState('')

  // ── Otros campos ───────────────────────────────────
  const [kmSalida, setKmSalida] = useState('')
  const [combustible, setCombustible] = useState('')
  const [foto, setFoto] = useState<File | null>(null)

  // ── Paradas intermedias ────────────────────────────
  const [usaParadas, setUsaParadas] = useState(false)
  const [paradasConfig, setParadasConfig] = useState<ParadaConfig[]>([
    { mode: 'lista', centroId: '', nombre: '' },
  ])

  const [errores, setErrores] = useState<Errores>({})
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState(false)

  useEffect(() => {
    if (!vehiculoCodigo) {
      setErrorGeneral('Código de vehículo no especificado.')
      setCargandoDatos(false)
      return
    }

    async function cargarDatos() {
      const [{ data: conds }, { data: centros }, { data: veh }] = await Promise.all([
        // Solo conductores del catálogo (no eventuales/manuales)
        supabase
          .from('conductores')
          .select('id, nombre, numero_empleado, estado, origen, es_eventual, observaciones, created_at, updated_at')
          .eq('estado', 'activo')
          .eq('es_eventual', false)
          .order('nombre'),
        // Solo centros del catálogo (no eventuales/manuales)
        supabase
          .from('centros_costo')
          .select('id, codigo, nombre, estado, origen, es_eventual, observaciones, created_at, updated_at')
          .eq('estado', 'activo')
          .eq('es_eventual', false)
          .order('nombre'),
        supabase
          .from('vehiculos')
          .select('km_actual')
          .eq('codigo', vehiculoCodigo)
          .single(),
      ])

      setConductores(conds ?? [])
      setCentrosCosto(centros ?? [])
      if (veh) setKmBase((veh as { km_actual: number }).km_actual)
      setCargandoDatos(false)
    }

    cargarDatos()
  }, [vehiculoCodigo])

  // ── Helpers de paradas ─────────────────────────────
  function agregarParada() {
    setParadasConfig((prev) => [...prev, { mode: 'lista', centroId: '', nombre: '' }])
  }

  function quitarParada(index: number) {
    setParadasConfig((prev) => prev.filter((_, i) => i !== index))
  }

  function actualizarParada(index: number, patch: Partial<ParadaConfig>) {
    setParadasConfig((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...patch } : p))
    )
  }

  // ── Validación ─────────────────────────────────────
  function validar(): boolean {
    const errs: Errores = {}

    if (conductorMode === 'lista' && !conductorId) {
      errs.conductor = 'Selecciona un conductor'
    } else if (conductorMode === 'manual' && !conductorNombre.trim()) {
      errs.conductor = 'Escribe el nombre del conductor'
    }

    if (centroCostoMode === 'lista' && !centroCostoId) {
      errs.centro_costo = 'Selecciona un destino'
    } else if (centroCostoMode === 'manual' && !centroCostoNombre.trim()) {
      errs.centro_costo = 'Escribe el nombre del destino'
    }

    const km = Number(kmSalida)
    if (!kmSalida || km < 0) {
      errs.km_salida = 'Ingresa los KM actuales'
    } else if (km < kmBase) {
      errs.km_salida = `Debe ser mayor o igual al KM actual del vehículo (${kmBase.toLocaleString()})`
    }

    if (!combustible) errs.combustible = 'Selecciona el nivel de combustible'
    if (!foto) errs.foto = 'La foto del tablero es obligatoria'

    if (usaParadas) {
      const invalida = paradasConfig.some((p) =>
        p.mode === 'lista' ? !p.centroId : !p.nombre.trim()
      )
      if (invalida) errs.paradas = 'Completa el destino de cada parada'
    }

    setErrores(errs)
    return Object.keys(errs).length === 0
  }

  // ── Submit ─────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validar()) return

    setEnviando(true)
    setErrorGeneral(null)

    try {
      // Verificar que no haya recorrido abierto
      const { data: abierto } = await supabase
        .from('recorridos')
        .select('id')
        .eq('vehiculo_codigo', vehiculoCodigo)
        .eq('estado', 'abierto')
        .maybeSingle()

      if (abierto) {
        setErrorGeneral('Este vehículo ya tiene un recorrido abierto.')
        setEnviando(false)
        return
      }

      // Resolver conductor (lista o RPC)
      let conductorIdFinal: number
      if (conductorMode === 'lista') {
        conductorIdFinal = Number(conductorId)
      } else {
        const { data, error } = await supabase.rpc('get_or_create_conductor', {
          p_nombre: conductorNombre.trim(),
        })
        if (error) throw new Error(error.message)
        conductorIdFinal = data as number
      }

      // Resolver centro de costo principal (lista o RPC)
      const centroCostoIdFinal = await resolverCentroCostoId({
        mode: centroCostoMode,
        centroId: centroCostoId,
        nombre: centroCostoNombre,
      })

      // Generar ID y subir foto
      const recorridoId = crypto.randomUUID()
      const fotoComprimida = await comprimirFoto(foto!)
      const fotoPath = buildFotoPath(vehiculoCodigo, recorridoId, 'salida')
      await subirFoto(fotoPath, fotoComprimida)

      // Insertar recorrido
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('recorridos') as any).insert({
        id: recorridoId,
        vehiculo_codigo: vehiculoCodigo,
        conductor_id: conductorIdFinal,
        centro_costo_id: centroCostoIdFinal,
        km_salida: Number(kmSalida),
        combustible_salida: Number(combustible),
        foto_salida_path: fotoPath,
        usa_paradas: usaParadas,
        estado: 'abierto',
        fecha_salida: new Date().toISOString(),
      })

      if (error) throw new Error(error.message)

      // Insertar paradas si aplica
      if (usaParadas && paradasConfig.length > 0) {
        // Resolver IDs de paradas (pueden ser manuales)
        const idsParadas = await Promise.all(paradasConfig.map((p) => resolverCentroCostoId(p)))

        const paradasPayload = idsParadas.map((centroId, idx) => ({
          recorrido_id: recorridoId,
          orden: idx + 1,
          centro_costo_id: centroId,
          estado: 'pendiente',
        }))

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: errParadas } = await (supabase.from('recorridos_paradas') as any).insert(paradasPayload)
        if (errParadas) throw new Error(errParadas.message)
      }

      setExito(true)
      setTimeout(() => router.push(`/vehiculo/${vehiculoCodigo}`), 2000)
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : 'Error al guardar. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  if (cargandoDatos) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando datos..." />
      </div>
    )
  }

  if (exito) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <span className="text-6xl">✅</span>
        <p className="text-xl font-bold text-gray-800">Salida registrada</p>
        <p className="text-gray-500 text-center">Vehículo <strong>{vehiculoCodigo}</strong> en ruta.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-blue-600 text-white px-4 py-5 shadow">
        <button onClick={() => router.back()} className="text-blue-200 text-sm mb-2">
          ← Volver
        </button>
        <h1 className="text-xl font-bold">Registrar salida</h1>
        <p className="text-blue-200 text-sm">Vehículo: {vehiculoCodigo}</p>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 px-4 py-6 max-w-md mx-auto w-full space-y-5">
        {errorGeneral && <ErrorMessage mensaje={errorGeneral} />}

        {kmBase > 0 && (
          <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
            KM actual del vehículo: <strong>{kmBase.toLocaleString()}</strong>
          </div>
        )}

        {/* ── Conductor ── */}
        <div className="space-y-1">
          {conductorMode === 'lista' ? (
            <Select
              label="Conductor"
              value={conductorId}
              onChange={(e) => setConductorId(e.target.value)}
              options={conductores.map((c) => ({ value: c.id, label: c.nombre }))}
              placeholder="Selecciona el conductor"
              error={errores.conductor}
            />
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
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            {conductorMode === 'lista' ? '¿No está en la lista? Escribir nombre' : 'Seleccionar de la lista'}
          </button>
        </div>

        {/* ── Centro de costo principal ── */}
        <div className="space-y-1">
          {centroCostoMode === 'lista' ? (
            <Select
              label="Destino / Centro de costo"
              value={centroCostoId}
              onChange={(e) => setCentroCostoId(e.target.value)}
              options={centrosCosto.map((c) => ({ value: c.id, label: c.nombre }))}
              placeholder="Selecciona el destino"
              error={errores.centro_costo}
            />
          ) : (
            <Input
              label="Destino / Centro de costo"
              type="text"
              value={centroCostoNombre}
              onChange={(e) => setCentroCostoNombre(e.target.value)}
              placeholder="Escribe el nombre del destino"
              error={errores.centro_costo}
            />
          )}
          <button
            type="button"
            onClick={() => {
              setCentroCostoMode((m) => (m === 'lista' ? 'manual' : 'lista'))
              setCentroCostoId('')
              setCentroCostoNombre('')
            }}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            {centroCostoMode === 'lista' ? '¿No está en la lista? Escribir destino' : 'Seleccionar de la lista'}
          </button>
        </div>

        {/* ── KM y combustible ── */}
        <Input
          label="KM actuales del odómetro"
          type="number"
          min={kmBase}
          value={kmSalida}
          onChange={(e) => setKmSalida(e.target.value)}
          placeholder={`Mín: ${kmBase.toLocaleString()}`}
          inputMode="numeric"
          error={errores.km_salida}
        />

        <Select
          label="Nivel de combustible"
          value={combustible}
          onChange={(e) => setCombustible(e.target.value)}
          options={COMBUSTIBLE_NIVELES.map((n) => ({ value: n.value, label: n.label }))}
          placeholder="Selecciona el nivel"
          error={errores.combustible}
        />

        <PhotoCapture
          label="Foto del tablero (odómetro)"
          onPhoto={setFoto}
          error={errores.foto}
        />

        {/* ── Paradas intermedias ── */}
        <div className="bg-gray-50 rounded-2xl border border-gray-200 p-4 space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={usaParadas}
              onChange={(e) => {
                setUsaParadas(e.target.checked)
                if (!e.target.checked) {
                  setParadasConfig([{ mode: 'lista', centroId: '', nombre: '' }])
                }
              }}
              className="w-5 h-5 rounded accent-blue-600"
            />
            <div>
              <p className="text-sm font-medium text-gray-800">Recorrido con paradas intermedias</p>
              <p className="text-xs text-gray-500">El vehículo visitará varios lugares antes de regresar</p>
            </div>
          </label>

          {usaParadas && (
            <div className="space-y-4 pt-1">
              <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                Paradas (en orden de visita)
              </p>

              {paradasConfig.map((parada, idx) => (
                <div key={idx} className="border border-gray-200 rounded-xl p-3 space-y-2 bg-white">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-500">Parada {idx + 1}</p>
                    {paradasConfig.length > 1 && (
                      <button
                        type="button"
                        onClick={() => quitarParada(idx)}
                        className="text-red-400 hover:text-red-600 text-sm"
                      >
                        Quitar
                      </button>
                    )}
                  </div>

                  {parada.mode === 'lista' ? (
                    <Select
                      label=""
                      value={parada.centroId}
                      onChange={(e) => actualizarParada(idx, { centroId: e.target.value })}
                      options={centrosCosto.map((c) => ({ value: c.id, label: c.nombre }))}
                      placeholder="Selecciona destino"
                    />
                  ) : (
                    <Input
                      label=""
                      type="text"
                      value={parada.nombre}
                      onChange={(e) => actualizarParada(idx, { nombre: e.target.value })}
                      placeholder="Escribe el nombre del destino"
                    />
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      actualizarParada(idx, {
                        mode: parada.mode === 'lista' ? 'manual' : 'lista',
                        centroId: '',
                        nombre: '',
                      })
                    }
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    {parada.mode === 'lista' ? '¿No está en la lista? Escribir destino' : 'Seleccionar de la lista'}
                  </button>
                </div>
              ))}

              {errores.paradas && (
                <p className="text-xs text-red-600">{errores.paradas}</p>
              )}

              <button
                type="button"
                onClick={agregarParada}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                + Agregar parada
              </button>
            </div>
          )}
        </div>

        <div className="pt-2 pb-8">
          <Button type="submit" loading={enviando}>
            Confirmar salida
          </Button>
        </div>
      </form>
    </div>
  )
}
