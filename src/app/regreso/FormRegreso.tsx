'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, type Recorrido, type RecorridoParadaConDetalle } from '@/lib/supabase'
import { comprimirFoto } from '@/lib/imageCompression'
import { COMBUSTIBLE_NIVELES, combustibleLabel } from '@/lib/constants'
import { buildFotoPath, subirFoto } from '@/utils/storage'
import { formatFecha } from '@/utils/formatters'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import PhotoCapture from '@/components/forms/PhotoCapture'
import ErrorMessage from '@/components/common/ErrorMessage'
import Loading from '@/components/common/Loading'

interface Errores {
  km_regreso?: string
  combustible?: string
  foto?: string
  litros?: string
  precio?: string
}

export default function FormRegreso() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const vehiculoCodigo = searchParams.get('vehiculo') ?? ''
  const recorridoId = searchParams.get('recorrido') ?? ''

  const [recorrido, setRecorrido] = useState<Recorrido | null>(null)
  const [paradas, setParadas] = useState<RecorridoParadaConDetalle[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  // Campos
  const [kmRegreso, setKmRegreso] = useState('')
  const [combustible, setCombustible] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [litros, setLitros] = useState('')
  const [precio, setPrecio] = useState('')

  const [errores, setErrores] = useState<Errores>({})
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState(false)

  useEffect(() => {
    if (!vehiculoCodigo || !recorridoId) {
      setErrorGeneral('Parámetros incompletos.')
      setCargando(false)
      return
    }

    async function cargarRecorrido() {
      const { data, error } = await supabase
        .from('recorridos')
        .select('*')
        .eq('id', recorridoId)
        .eq('vehiculo_codigo', vehiculoCodigo)
        .eq('estado', 'abierto')
        .single()

      if (error || !data) {
        setErrorGeneral('No se encontró un recorrido abierto para este vehículo.')
        setCargando(false)
        return
      }

      const rec = data as Recorrido
      setRecorrido(rec)

      // Si el recorrido tiene paradas, cargarlas para mostrar resumen
      if (rec.usa_paradas) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: paradasData } = await (supabase.from('recorridos_paradas') as any)
          .select('*, centros_costo(nombre, codigo)')
          .eq('recorrido_id', recorridoId)
          .order('orden', { ascending: true })

        setParadas((paradasData ?? []) as RecorridoParadaConDetalle[])
      }

      setCargando(false)
    }

    cargarRecorrido()
  }, [vehiculoCodigo, recorridoId])

  // KM mínimo para el regreso: el mayor entre km_salida y el km de la última parada completada
  const kmMinRegreso = paradas.length > 0
    ? Math.max(
        recorrido?.km_salida ?? 0,
        ...paradas
          .filter((p) => p.estado === 'completada' && p.km_parada != null)
          .map((p) => p.km_parada as number)
      )
    : (recorrido?.km_salida ?? 0)

  function validar(): boolean {
    const errs: Errores = {}
    const km = Number(kmRegreso)

    if (!kmRegreso || km < 0) {
      errs.km_regreso = 'Ingresa los KM de regreso'
    } else if (km < kmMinRegreso) {
      errs.km_regreso = `Debe ser mayor o igual a ${kmMinRegreso.toLocaleString()} KM`
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
    if (!validar() || !recorrido) return

    setEnviando(true)
    setErrorGeneral(null)

    try {
      // Comprimir y subir foto
      const fotoComprimida = await comprimirFoto(foto!)
      const fotoPath = buildFotoPath(vehiculoCodigo, recorridoId, 'regreso')
      await subirFoto(fotoPath, fotoComprimida)

      // Actualizar recorrido
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('recorridos') as any)
        .update({
          km_regreso: Number(kmRegreso),
          combustible_regreso: Number(combustible),
          foto_regreso_path: fotoPath,
          litros_cargados: litros ? Number(litros) : null,
          precio_litro: precio ? Number(precio) : null,
          estado: 'cerrado',
          fecha_regreso: new Date().toISOString(),
        })
        .eq('id', recorridoId)

      if (error) throw new Error(error.message)

      setExito(true)
      setTimeout(() => router.push('/historico'), 2000)
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : 'Error al guardar. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando recorrido..." />
      </div>
    )
  }

  if (exito) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <span className="text-6xl">✅</span>
        <p className="text-xl font-bold text-gray-800">Regreso registrado</p>
        <p className="text-gray-500 text-center">Recorrido cerrado exitosamente.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-orange-500 text-white px-4 py-5 shadow">
        <button onClick={() => router.back()} className="text-orange-100 text-sm mb-2">
          ← Volver
        </button>
        <h1 className="text-xl font-bold">Registrar regreso</h1>
        <p className="text-orange-100 text-sm">Vehículo: {vehiculoCodigo}</p>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 px-4 py-6 max-w-md mx-auto w-full space-y-5">
        {errorGeneral && <ErrorMessage mensaje={errorGeneral} />}

        {/* Datos del recorrido abierto */}
        {recorrido && (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3 space-y-1 text-sm">
            <p className="font-semibold text-orange-800">Datos de salida</p>
            <p className="text-orange-700">
              Salida: {formatFecha(recorrido.fecha_salida)}
            </p>
            <p className="text-orange-700">
              KM salida: <strong>{recorrido.km_salida.toLocaleString()}</strong>
              {' · '}
              Combustible: <strong>{combustibleLabel(recorrido.combustible_salida)}</strong>
            </p>
          </div>
        )}

        {/* Resumen de paradas si el recorrido las tuvo */}
        {recorrido?.usa_paradas && paradas.length > 0 && (
          <div className="bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3 space-y-2 text-sm">
            <p className="font-semibold text-purple-800">Paradas del recorrido</p>
            {paradas.map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <div>
                  <span className="text-purple-700 font-medium">#{p.orden} </span>
                  <span className="text-purple-700">{p.centros_costo?.nombre ?? '—'}</span>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    p.estado === 'completada'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {p.estado === 'completada' ? 'Completada' : 'Pendiente'}
                </span>
              </div>
            ))}
          </div>
        )}

        <Input
          label="KM actuales del odómetro"
          type="number"
          min={kmMinRegreso}
          value={kmRegreso}
          onChange={(e) => setKmRegreso(e.target.value)}
          placeholder={`Mín: ${kmMinRegreso.toLocaleString()}`}
          inputMode="numeric"
          error={errores.km_regreso}
        />

        {kmRegreso && recorrido && Number(kmRegreso) >= recorrido.km_salida && (
          <p className="text-sm text-green-700 bg-green-50 rounded-xl px-3 py-2">
            KM recorridos totales: <strong>{(Number(kmRegreso) - recorrido.km_salida).toLocaleString()}</strong>
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
          <p className="text-sm font-medium text-gray-700">Carga de combustible en regreso (opcional)</p>
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
          {litros && precio && (
            <p className="text-sm text-blue-700 bg-blue-50 rounded-xl px-3 py-2">
              Importe estimado:{' '}
              <strong>
                ${(Number(litros) * Number(precio)).toFixed(3)}
              </strong>
            </p>
          )}
        </div>

        <div className="pt-2 pb-8">
          <Button type="submit" loading={enviando}>
            Confirmar regreso
          </Button>
        </div>
      </form>
    </div>
  )
}
