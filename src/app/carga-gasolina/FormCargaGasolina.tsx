'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, type Conductor } from '@/lib/supabase'
import { comprimirFoto } from '@/lib/imageCompression'
import FuelGauge from '@/components/forms/FuelGauge'
import { buildFotoCargaPath, subirFotoCarga } from '@/utils/storage'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import PhotoCapture from '@/components/forms/PhotoCapture'
import ErrorMessage from '@/components/common/ErrorMessage'
import Loading from '@/components/common/Loading'

interface Errores {
  conductor?: string
  km_antes?: string
  combustible_antes?: string
  foto_antes?: string
  combustible_despues?: string
  litros?: string
  precio?: string
  foto_despues?: string
  foto_ticket?: string
}

async function resolverRecorridoId(vehiculoCodigo: string, kmAntes: number): Promise<string | null> {
  // 1. Recorrido abierto del vehículo cuyo km_salida <= km_antes
  const { data: abierto } = await supabase
    .from('recorridos')
    .select('id, km_salida')
    .eq('vehiculo_codigo', vehiculoCodigo)
    .eq('estado', 'abierto')
    .lte('km_salida', kmAntes)
    .maybeSingle()

  if (abierto) return (abierto as { id: string }).id

  // 2. Recorrido cerrado cuyo rango km_salida–km_regreso contiene km_antes
  const { data: cerrado } = await supabase
    .from('recorridos')
    .select('id, km_salida, km_regreso')
    .eq('vehiculo_codigo', vehiculoCodigo)
    .eq('estado', 'cerrado')
    .lte('km_salida', kmAntes)
    .gte('km_regreso', kmAntes)
    .order('fecha_salida', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (cerrado) return (cerrado as { id: string }).id

  return null
}

async function procesarFoto(file: File, path: string, etiqueta: string): Promise<void> {
  let comprimida: File
  try {
    comprimida = await comprimirFoto(file)
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err)
    throw new Error(`Foto "${etiqueta}" (compresión): ${detalle}`)
  }
  try {
    await subirFotoCarga(path, comprimida)
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err)
    throw new Error(`Foto "${etiqueta}" (subida): ${detalle}`)
  }
}

export default function FormCargaGasolina() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const vehiculoCodigo = searchParams.get('vehiculo') ?? ''

  const [conductores, setConductores] = useState<Conductor[]>([])
  const [kmBase, setKmBase] = useState<number>(0)
  const [cargandoDatos, setCargandoDatos] = useState(true)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  // ── Conductor ──────────────────────────────────────
  const [conductorMode, setConductorMode] = useState<'lista' | 'manual'>('lista')
  const [conductorId, setConductorId] = useState('')
  const [conductorNombre, setConductorNombre] = useState('')

  // ── Sección A ──────────────────────────────────────
  const [kmAntes, setKmAntes] = useState('')
  const [combustibleAntes, setCombustibleAntes] = useState<number | null>(null)
  const [fotoAntes, setFotoAntes] = useState<File | null>(null)

  // ── Sección B ──────────────────────────────────────
  const [combustibleDespues, setCombustibleDespues] = useState<number | null>(null)
  const [litros, setLitros] = useState('')
  const [precio, setPrecio] = useState('')
  const [fotoDespues, setFotoDespues] = useState<File | null>(null)
  const [fotoTicket, setFotoTicket] = useState<File | null>(null)

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
      const [{ data: conds }, { data: veh }] = await Promise.all([
        supabase
          .from('conductores')
          .select('id, nombre, numero_empleado, estado, origen, es_eventual, observaciones, created_at, updated_at')
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
      if (veh) setKmBase((veh as { km_actual: number }).km_actual)
      setCargandoDatos(false)
    }

    cargarDatos()
  }, [vehiculoCodigo])

  function puedeEnviar(): boolean {
    // Validación rápida sin mostrar errores
    if (conductorMode === 'lista' && !conductorId) return false
    if (conductorMode === 'manual' && !conductorNombre.trim()) return false

    const kmA = Number(kmAntes)
    if (!kmAntes || kmA < 0) return false

    if (combustibleAntes === null) return false
    if (!fotoAntes) return false

    if (combustibleDespues === null) return false
    if (!litros || Number(litros) <= 0) return false
    if (!precio || Number(precio) <= 0) return false
    if (!fotoDespues) return false
    if (!fotoTicket) return false

    return true
  }

  function validar(): boolean {
    const errs: Errores = {}

    if (conductorMode === 'lista' && !conductorId) {
      errs.conductor = 'Selecciona un conductor'
    } else if (conductorMode === 'manual' && !conductorNombre.trim()) {
      errs.conductor = 'Escribe el nombre del conductor'
    }

    const kmA = Number(kmAntes)
    if (!kmAntes || kmA < 0) {
      errs.km_antes = 'Ingresa los KM del odómetro antes de cargar'
    }

    if (combustibleAntes === null) errs.combustible_antes = 'Selecciona el nivel antes de cargar'
    if (!fotoAntes) errs.foto_antes = 'La foto del tablero antes de cargar es obligatoria'

    if (combustibleDespues === null) errs.combustible_despues = 'Selecciona el nivel después de cargar'
    if (!litros || Number(litros) <= 0) errs.litros = 'Ingresa los litros cargados (mayor a 0)'
    if (!precio || Number(precio) <= 0) errs.precio = 'Ingresa el precio por litro (mayor a 0)'
    if (!fotoDespues) errs.foto_despues = 'La foto del tablero después de cargar es obligatoria'
    if (!fotoTicket) errs.foto_ticket = 'La foto del ticket de gasolina es obligatoria'

    setErrores(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validar()) return

    setEnviando(true)
    setErrorGeneral(null)

    try {
      // Resolver conductor
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

      // Resolver recorrido asociado
      const kmA = Number(kmAntes)
      const recorridoIdFinal = await resolverRecorridoId(vehiculoCodigo, kmA)

      // Generar ID y subir 3 fotos en paralelo
      const cargaId = crypto.randomUUID()
      const pathAntes = buildFotoCargaPath(vehiculoCodigo, cargaId, 'tablero_antes')
      const pathDespues = buildFotoCargaPath(vehiculoCodigo, cargaId, 'tablero_despues')
      const pathTicket = buildFotoCargaPath(vehiculoCodigo, cargaId, 'ticket')

      await Promise.all([
        procesarFoto(fotoAntes!, pathAntes, 'tablero antes'),
        procesarFoto(fotoDespues!, pathDespues, 'tablero después'),
        procesarFoto(fotoTicket!, pathTicket, 'ticket'),
      ])

      // Insertar carga
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('cargas_gasolina') as any).insert({
        id: cargaId,
        vehiculo_codigo: vehiculoCodigo,
        conductor_id: conductorIdFinal,
        recorrido_id: recorridoIdFinal,
        km_antes: kmA,
        combustible_antes: combustibleAntes as number,
        foto_tablero_antes_path: pathAntes,
        combustible_despues: combustibleDespues as number,
        litros_cargados: Number(litros),
        precio_litro: Number(precio),
        foto_tablero_despues_path: pathDespues,
        foto_ticket_path: pathTicket,
      })

      if (error) throw new Error(error.message)

      setExito(true)
      setTimeout(() => router.push(`/vehiculo/${vehiculoCodigo}`), 2000)
    } catch (err) {
      console.error('Error al guardar carga de gasolina:', err)
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
        <span className="text-6xl">⛽</span>
        <p className="text-xl font-bold text-gray-800">Carga registrada</p>
        <p className="text-gray-500 text-center">
          La carga de gasolina del vehículo <strong>{vehiculoCodigo}</strong> fue guardada.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-green-600 text-white px-4 py-5 shadow">
        <button onClick={() => router.back()} className="text-green-200 text-sm mb-2">
          ← Volver
        </button>
        <h1 className="text-xl font-bold">Registrar carga de gasolina</h1>
        <p className="text-green-200 text-sm">Vehículo: {vehiculoCodigo}</p>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 px-4 py-6 max-w-md mx-auto w-full space-y-5">
        {errorGeneral && <ErrorMessage mensaje={errorGeneral} />}

        {kmBase > 0 && (
          <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            KM actual del vehículo: <strong>{kmBase.toLocaleString()}</strong>
          </div>
        )}

        {/* ── Conductor ── */}
        <div className="space-y-1">
          {conductorMode === 'lista' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Conductor</label>
              <select
                value={conductorId}
                onChange={(e) => setConductorId(e.target.value)}
                className={`w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${errores.conductor ? 'border-red-400' : 'border-gray-300'}`}
              >
                <option value="">Selecciona el conductor</option>
                {conductores.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
              {errores.conductor && <p className="text-xs text-red-500 mt-1">{errores.conductor}</p>}
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
            className="text-xs text-green-600 hover:text-green-800"
          >
            {conductorMode === 'lista' ? '¿No está en la lista? Escribir nombre' : 'Seleccionar de la lista'}
          </button>
        </div>

        {/* ── Sección A: Antes de cargar ── */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-4">
          <p className="text-sm font-semibold text-blue-800">Antes de cargar gasolina</p>

          <Input
            label="KM del odómetro"
            type="number"
            min={0}
            value={kmAntes}
            onChange={(e) => setKmAntes(e.target.value)}
            placeholder={`Ej: ${kmBase.toLocaleString()}`}
            inputMode="numeric"
            error={errores.km_antes}
          />
          {kmAntes && Number(kmAntes) > 0 && Number(kmAntes) < kmBase && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              El KM ingresado es menor al registrado en el sistema ({kmBase.toLocaleString()}). Se guardará como carga retroactiva.
            </p>
          )}

          <FuelGauge
            label="Nivel de combustible (antes)"
            value={combustibleAntes}
            onChange={setCombustibleAntes}
            error={errores.combustible_antes}
          />

          <PhotoCapture
            label="Foto del tablero (antes)"
            onPhoto={setFotoAntes}
            error={errores.foto_antes}
          />
        </div>

        {/* ── Sección B: Después de cargar ── */}
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 space-y-4">
          <p className="text-sm font-semibold text-green-800">Después de cargar gasolina</p>

          <FuelGauge
            label="Nivel de combustible (después)"
            value={combustibleDespues}
            onChange={setCombustibleDespues}
            error={errores.combustible_despues}
          />

          <Input
            label="Litros cargados"
            type="number"
            min={0}
            step="0.001"
            value={litros}
            onChange={(e) => setLitros(e.target.value)}
            placeholder="Ej: 35.500"
            inputMode="decimal"
            error={errores.litros}
          />

          <Input
            label="Precio por litro ($)"
            type="number"
            min={0}
            step="0.001"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="Ej: 23.500"
            inputMode="decimal"
            error={errores.precio}
          />

          {litros && precio && Number(litros) > 0 && Number(precio) > 0 && (
            <p className="text-sm text-green-700 bg-green-100 rounded-xl px-3 py-2">
              Total estimado: <strong>${(Number(litros) * Number(precio)).toFixed(2)}</strong>
            </p>
          )}

          <PhotoCapture
            label="Foto del tablero (después)"
            onPhoto={setFotoDespues}
            error={errores.foto_despues}
          />

          <PhotoCapture
            label="Foto del ticket de gasolina"
            onPhoto={setFotoTicket}
            error={errores.foto_ticket}
          />
        </div>

        <div className="pt-2 pb-8">
          <Button type="submit" loading={enviando} disabled={!puedeEnviar()}>
            Registrar carga de gasolina
          </Button>
        </div>
      </form>
    </div>
  )
}
