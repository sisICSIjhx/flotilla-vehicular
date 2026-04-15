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

interface Errores {
  conductor?: string
  centro_costo?: string
  km_salida?: string
  combustible?: string
  foto?: string
}

export default function FormSalida() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const vehiculoCodigo = searchParams.get('vehiculo') ?? ''

  const [conductores, setConductores] = useState<Conductor[]>([])
  const [centrosCosto, setCentrosCosto] = useState<CentroCosto[]>([])
  const [cargandoDatos, setCargandoDatos] = useState(true)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  // Campos del formulario
  const [conductorId, setConductorId] = useState('')
  const [centroCostoId, setCentroCostoId] = useState('')
  const [kmSalida, setKmSalida] = useState('')
  const [combustible, setCombustible] = useState('')
  const [foto, setFoto] = useState<File | null>(null)

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
      const [{ data: conds }, { data: centros }] = await Promise.all([
        supabase.from('conductores').select('id, nombre, numero_empleado, estado, created_at, updated_at').eq('estado', 'activo').order('nombre'),
        supabase.from('centros_costo').select('id, codigo, nombre, created_at').order('nombre'),
      ])

      setConductores(conds ?? [])
      setCentrosCosto(centros ?? [])
      setCargandoDatos(false)
    }

    cargarDatos()
  }, [vehiculoCodigo])

  function validar(): boolean {
    const errs: Errores = {}
    if (!conductorId) errs.conductor = 'Selecciona un conductor'
    if (!centroCostoId) errs.centro_costo = 'Selecciona un centro de costo'
    if (!kmSalida || Number(kmSalida) < 0) errs.km_salida = 'Ingresa los KM actuales'
    if (!combustible) errs.combustible = 'Selecciona el nivel de combustible'
    if (!foto) errs.foto = 'La foto del tablero es obligatoria'
    setErrores(errs)
    return Object.keys(errs).length === 0
  }

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

      // Generar ID para el recorrido (necesario antes de subir la foto)
      const recorridoId = crypto.randomUUID()

      // Comprimir y subir foto
      const fotoComprimida = await comprimirFoto(foto!)
      const fotoPath = buildFotoPath(vehiculoCodigo, recorridoId, 'salida')
      await subirFoto(fotoPath, fotoComprimida)

      // Insertar recorrido
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('recorridos') as any).insert({
        id: recorridoId,
        vehiculo_codigo: vehiculoCodigo,
        conductor_id: Number(conductorId),
        centro_costo_id: Number(centroCostoId),
        km_salida: Number(kmSalida),
        combustible_salida: Number(combustible),
        foto_salida_path: fotoPath,
        estado: 'abierto',
        fecha_salida: new Date().toISOString(),
      })

      if (error) throw new Error(error.message)

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

        {conductores.length === 0 && (
          <div className="rounded-xl bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
            No hay conductores activos. Agrega conductores en la base de datos.
          </div>
        )}

        <Select
          label="Conductor"
          value={conductorId}
          onChange={(e) => setConductorId(e.target.value)}
          options={conductores.map((c) => ({
            value: c.id,
            label: c.numero_empleado ? `${c.nombre} (${c.numero_empleado})` : c.nombre,
          }))}
          placeholder="Selecciona el conductor"
          error={errores.conductor}
        />

        <Select
          label="Centro de costo"
          value={centroCostoId}
          onChange={(e) => setCentroCostoId(e.target.value)}
          options={centrosCosto.map((c) => ({ value: c.id, label: c.nombre }))}
          placeholder="Selecciona el centro de costo"
          error={errores.centro_costo}
        />

        <Input
          label="KM actuales del odómetro"
          type="number"
          min={0}
          value={kmSalida}
          onChange={(e) => setKmSalida(e.target.value)}
          placeholder="Ej: 45230"
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

        <div className="pt-2 pb-8">
          <Button type="submit" loading={enviando} disabled={conductores.length === 0}>
            Confirmar salida
          </Button>
        </div>
      </form>
    </div>
  )
}
