'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, type CentroCosto, type Recorrido } from '@/lib/supabase'
import Button from '@/components/common/Button'
import ErrorMessage from '@/components/common/ErrorMessage'
import Loading from '@/components/common/Loading'
import CentroCostoPicker, {
  type CentroCostoValue,
  CENTRO_COSTO_VACIO,
  centroCostoValido,
  resolverCentroCostoId,
} from '@/components/forms/CentroCostoPicker'

// El conductor puede añadir una parada aunque el viaje ya esté
// iniciado: la parada se agrega al final de la ruta como pendiente.
export default function FormNuevaParada() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const vehiculoCodigo = searchParams.get('vehiculo') ?? ''
  const recorridoId = searchParams.get('recorrido') ?? ''

  const [recorrido, setRecorrido] = useState<Recorrido | null>(null)
  const [centros, setCentros] = useState<Pick<CentroCosto, 'id' | 'nombre'>[]>([])
  const [paradasExistentes, setParadasExistentes] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [bloqueadoMantenimiento, setBloqueadoMantenimiento] = useState(false)

  const [centro, setCentro] = useState<CentroCostoValue>(CENTRO_COSTO_VACIO)
  const [errorCentro, setErrorCentro] = useState<string | undefined>(undefined)
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState(false)

  useEffect(() => {
    if (!vehiculoCodigo || !recorridoId) {
      setErrorGeneral('Parámetros incompletos.')
      setCargando(false)
      return
    }

    async function cargarDatos() {
      try {
        const [{ data: rec }, { data: cens }, { count }, { data: veh }] = await Promise.all([
          supabase
            .from('recorridos')
            .select('*')
            .eq('id', recorridoId)
            .eq('vehiculo_codigo', vehiculoCodigo)
            .eq('estado', 'abierto')
            .maybeSingle(),
          supabase
            .from('centros_costo')
            .select('id, nombre')
            .eq('estado', 'activo')
            .eq('es_eventual', false)
            .order('nombre'),
          supabase
            .from('recorridos_paradas')
            .select('id', { count: 'exact', head: true })
            .eq('recorrido_id', recorridoId),
          supabase.from('vehiculos').select('estado').eq('codigo', vehiculoCodigo).maybeSingle(),
        ])

        if (!rec) {
          setErrorGeneral('No se encontró un recorrido abierto para este vehículo.')
          setCargando(false)
          return
        }

        // La unidad puede haber entrado a mantenimiento excepcionalmente sin
        // cerrar este recorrido: mientras dure, no se permiten paradas nuevas.
        if ((veh as { estado?: string } | null)?.estado === 'mantenimiento') {
          setBloqueadoMantenimiento(true)
          setCargando(false)
          return
        }

        setRecorrido(rec as Recorrido)
        setCentros((cens as any[]) ?? [])
        setParadasExistentes(count ?? 0)
      } catch {
        setErrorGeneral('Error al cargar los datos. Intenta de nuevo.')
      } finally {
        setCargando(false)
      }
    }

    cargarDatos()
  }, [vehiculoCodigo, recorridoId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!recorrido) return

    if (!centroCostoValido(centro)) {
      setErrorCentro(centro.mode === 'lista' ? 'Selecciona el destino' : 'Escribe el nombre del destino')
      return
    }
    setErrorCentro(undefined)
    setEnviando(true)
    setErrorGeneral(null)

    try {
      const centroId = await resolverCentroCostoId(centro)

      // Calcular el siguiente orden al momento de guardar
      // (por si otro dispositivo agregó paradas mientras tanto)
      const { data: ultima } = await (supabase.from('recorridos_paradas') as any)
        .select('orden')
        .eq('recorrido_id', recorrido.id)
        .order('orden', { ascending: false })
        .limit(1)
        .maybeSingle()

      let orden = ((ultima?.orden as number | undefined) ?? 0) + 1

      let { error } = await (supabase.from('recorridos_paradas') as any).insert({
        recorrido_id: recorrido.id,
        orden,
        centro_costo_id: centroId,
        estado: 'pendiente',
      })

      // Colisión de orden (índice único): reintentar con el siguiente
      if (error && error.message.includes('uq_recorrido_parada_orden')) {
        orden += 1
        const retry = await (supabase.from('recorridos_paradas') as any).insert({
          recorrido_id: recorrido.id,
          orden,
          centro_costo_id: centroId,
          estado: 'pendiente',
        })
        error = retry.error
      }
      if (error) throw new Error(error.message)

      // Si el recorrido inició sin paradas, activar la bandera
      if (!recorrido.usa_paradas) {
        const { error: errFlag } = await (supabase.from('recorridos') as any)
          .update({ usa_paradas: true })
          .eq('id', recorrido.id)
        if (errFlag) throw new Error(errFlag.message)
      }

      setExito(true)
      setTimeout(() => router.push(`/vehiculo/${vehiculoCodigo}`), 1500)
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : 'Error al guardar. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando..." />
      </div>
    )
  }

  if (exito) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <span className="text-6xl">✅</span>
        <p className="text-xl font-bold text-gray-800">Parada agregada</p>
        <p className="text-gray-500 text-center">
          Se añadió a la ruta del vehículo <strong>{vehiculoCodigo}</strong>.
        </p>
      </div>
    )
  }

  if (bloqueadoMantenimiento) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <span className="text-6xl">🔧</span>
        <p className="text-xl font-bold text-gray-800">Unidad en mantenimiento</p>
        <p className="text-gray-500 max-w-sm">
          El vehículo <strong>{vehiculoCodigo}</strong> está en el taller (ingreso excepcional con
          el recorrido abierto) y no puede registrar paradas hasta que el administrador cierre el
          mantenimiento.
        </p>
        <Button variant="secondary" onClick={() => router.push(`/vehiculo/${vehiculoCodigo}`)}>
          Volver
        </Button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-purple-600 text-white px-4 py-5 shadow">
        <button onClick={() => router.back()} className="text-purple-200 text-sm mb-2">
          ← Volver
        </button>
        <h1 className="text-xl font-bold">Añadir parada</h1>
        <p className="text-purple-200 text-sm">Vehículo: {vehiculoCodigo}</p>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 px-4 py-6 max-w-md mx-auto w-full space-y-5">
        {errorGeneral && <ErrorMessage mensaje={errorGeneral} />}

        {recorrido && (
          <div className="bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3 text-sm space-y-1">
            <p className="font-semibold text-purple-800">Recorrido en curso</p>
            <p className="text-purple-700">
              {paradasExistentes > 0
                ? `La nueva parada se agregará al final de la ruta (será la #${paradasExistentes + 1}).`
                : 'Este recorrido no tenía paradas; esta será la primera.'}
            </p>
          </div>
        )}

        {recorrido && (
          <>
            <CentroCostoPicker
              label="¿A dónde es la nueva parada?"
              centros={centros}
              value={centro}
              onChange={setCentro}
              error={errorCentro}
            />

            <div className="pt-2 pb-8">
              <Button type="submit" loading={enviando}>
                Agregar parada a la ruta
              </Button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
