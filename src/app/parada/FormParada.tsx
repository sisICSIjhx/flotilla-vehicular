'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, type RecorridoParada, type CentroCosto } from '@/lib/supabase'
import { comprimirFoto } from '@/lib/imageCompression'
import { COMBUSTIBLE_NIVELES } from '@/lib/constants'
import { buildFotoParadaPath, subirFoto } from '@/utils/storage'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import PhotoCapture from '@/components/forms/PhotoCapture'
import ErrorMessage from '@/components/common/ErrorMessage'
import Loading from '@/components/common/Loading'

interface Errores {
  km_parada?: string
  combustible?: string
  foto?: string
  litros?: string
  precio?: string
}

export default function FormParada() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const vehiculoCodigo = searchParams.get('vehiculo') ?? ''
  const recorridoId = searchParams.get('recorrido') ?? ''
  const paradaId = searchParams.get('parada') ?? ''
  const orden = Number(searchParams.get('orden') ?? '1')

  const [parada, setParada] = useState<RecorridoParada | null>(null)
  const [centroCosto, setCentroCosto] = useState<Pick<CentroCosto, 'nombre'> | null>(null)
  const [kmReferencia, setKmReferencia] = useState<number>(0)
  const [cargando, setCargando] = useState(true)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  // Campos
  const [kmParada, setKmParada] = useState('')
  const [combustible, setCombustible] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [litros, setLitros] = useState('')
  const [precio, setPrecio] = useState('')

  const [errores, setErrores] = useState<Errores>({})
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState(false)

  useEffect(() => {
    if (!vehiculoCodigo || !recorridoId || !paradaId) {
      setErrorGeneral('Parámetros incompletos.')
      setCargando(false)
      return
    }

    async function cargarDatos() {
      try {
        // Cargar la parada con el centro de costo
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: paradaData, error: paradaError } = await (supabase.from('recorridos_paradas') as any)
          .select('*, centros_costo(nombre)')
          .eq('id', paradaId)
          .eq('recorrido_id', recorridoId)
          .eq('estado', 'pendiente')
          .single()

        if (paradaError || !paradaData) {
          setErrorGeneral('No se encontró la parada pendiente.')
          setCargando(false)
          return
        }

        const p = paradaData as RecorridoParada & { centros_costo: { nombre: string } }
        setParada(p)
        setCentroCosto({ nombre: p.centros_costo?.nombre ?? '' })

        // Obtener km de referencia: última parada completada o km_salida del recorrido
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: anterior } = await (supabase.from('recorridos_paradas') as any)
          .select('km_parada')
          .eq('recorrido_id', recorridoId)
          .eq('estado', 'completada')
          .order('orden', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (anterior?.km_parada != null) {
          setKmReferencia(anterior.km_parada as number)
        } else {
          const { data: rec } = await supabase
            .from('recorridos')
            .select('km_salida')
            .eq('id', recorridoId)
            .single()
          if (rec) setKmReferencia((rec as { km_salida: number }).km_salida)
        }
      } catch {
        setErrorGeneral('Error al cargar los datos de la parada.')
      } finally {
        setCargando(false)
      }
    }

    cargarDatos()
  }, [vehiculoCodigo, recorridoId, paradaId])

  function validar(): boolean {
    const errs: Errores = {}
    const km = Number(kmParada)

    if (!kmParada || km < 0) {
      errs.km_parada = 'Ingresa el KM al llegar a la parada'
    } else if (km < kmReferencia) {
      errs.km_parada = `Debe ser mayor o igual a ${kmReferencia.toLocaleString()} KM`
    }
    if (!combustible) errs.combustible = 'Selecciona el nivel de combustible'
    if (!foto) errs.foto = 'La foto del tablero es obligatoria'
    if (litros && Number(litros) < 0) errs.litros = 'Ingresa un valor válido'
    if (precio && Number(precio) < 0) errs.precio = 'Ingresa un valor válido'

    setErrores(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validar() || !parada) return

    setEnviando(true)
    setErrorGeneral(null)

    try {
      // Comprimir y subir foto
      const fotoComprimida = await comprimirFoto(foto!)
      const fotoPath = buildFotoParadaPath(vehiculoCodigo, recorridoId, orden)
      await subirFoto(fotoPath, fotoComprimida)

      // Actualizar parada a completada
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('recorridos_paradas') as any)
        .update({
          km_parada: Number(kmParada),
          combustible_parada: Number(combustible),
          foto_parada_path: fotoPath,
          litros_cargados: litros ? Number(litros) : null,
          precio_litro: precio ? Number(precio) : null,
          estado: 'completada',
          fecha_parada: new Date().toISOString(),
        })
        .eq('id', paradaId)

      if (error) throw new Error(error.message)

      setExito(true)
      setTimeout(() => router.push(`/vehiculo/${vehiculoCodigo}`), 2000)
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : 'Error al guardar. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando parada..." />
      </div>
    )
  }

  if (exito) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <span className="text-6xl">✅</span>
        <p className="text-xl font-bold text-gray-800">Parada registrada</p>
        <p className="text-gray-500 text-center">
          Parada #{orden} completada. Verificando siguiente acción...
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-purple-600 text-white px-4 py-5 shadow">
        <button onClick={() => router.back()} className="text-purple-200 text-sm mb-2">
          ← Volver
        </button>
        <h1 className="text-xl font-bold">Parada #{orden}</h1>
        <p className="text-purple-200 text-sm">Vehículo: {vehiculoCodigo}</p>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 px-4 py-6 max-w-md mx-auto w-full space-y-5">
        {errorGeneral && <ErrorMessage mensaje={errorGeneral} />}

        {/* Destino de la parada */}
        {centroCosto && (
          <div className="bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3 space-y-1 text-sm">
            <p className="font-semibold text-purple-800">Destino de esta parada</p>
            <p className="text-purple-700 text-base font-medium">{centroCosto.nombre}</p>
            {kmReferencia > 0 && (
              <p className="text-purple-600">
                KM de referencia (mínimo): <strong>{kmReferencia.toLocaleString()}</strong>
              </p>
            )}
          </div>
        )}

        <Input
          label="KM actuales del odómetro"
          type="number"
          min={kmReferencia}
          value={kmParada}
          onChange={(e) => setKmParada(e.target.value)}
          placeholder={`Mín: ${kmReferencia.toLocaleString()}`}
          inputMode="numeric"
          error={errores.km_parada}
        />

        {kmParada && Number(kmParada) >= kmReferencia && (
          <p className="text-sm text-green-700 bg-green-50 rounded-xl px-3 py-2">
            KM recorridos hasta aquí: <strong>{(Number(kmParada) - kmReferencia).toLocaleString()}</strong>
          </p>
        )}

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

        {/* Carga de combustible (opcional) */}
        <div className="bg-gray-50 rounded-2xl border border-gray-200 p-4 space-y-4">
          <p className="text-sm font-medium text-gray-700">Carga de combustible en esta parada (opcional)</p>
          <Input
            label="Litros cargados"
            type="number"
            min={0}
            step="0.01"
            value={litros}
            onChange={(e) => setLitros(e.target.value)}
            placeholder="Ej: 35.5"
            inputMode="decimal"
            error={errores.litros}
          />
          <Input
            label="Precio por litro ($)"
            type="number"
            min={0}
            step="0.01"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="Ej: 23.50"
            inputMode="decimal"
            error={errores.precio}
          />
          {litros && precio && (
            <p className="text-sm text-blue-700 bg-blue-50 rounded-xl px-3 py-2">
              Importe estimado:{' '}
              <strong>${(Number(litros) * Number(precio)).toFixed(2)}</strong>
            </p>
          )}
        </div>

        <div className="pt-2 pb-8">
          <Button type="submit" loading={enviando}>
            Confirmar parada #{orden}
          </Button>
        </div>
      </form>
    </div>
  )
}
