'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, type Recorrido, type Vehiculo } from '@/lib/supabase'
import Loading from '@/components/common/Loading'
import Button from '@/components/common/Button'
import { formatFecha } from '@/utils/formatters'
import { combustibleLabel } from '@/lib/constants'

type Estado = 'cargando' | 'no_encontrado' | 'disponible' | 'en_ruta'

export default function VehiculoPage() {
  const params = useParams()
  const router = useRouter()
  const codigo = (params.codigo as string).toUpperCase()

  const [estado, setEstado] = useState<Estado>('cargando')
  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null)
  const [recorridoAbierto, setRecorridoAbierto] = useState<Recorrido | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function verificar() {
      try {
        // 1. Verificar que el vehículo existe
        const { data: veh, error: vehError } = await supabase
          .from('vehiculos')
          .select('*')
          .eq('codigo', codigo)
          .single()

        if (vehError || !veh) {
          setEstado('no_encontrado')
          return
        }

        setVehiculo(veh)

        // 2. Buscar recorrido abierto
        const { data: rec } = await supabase
          .from('recorridos')
          .select('*')
          .eq('vehiculo_codigo', codigo)
          .eq('estado', 'abierto')
          .maybeSingle()

        if (rec) {
          setRecorridoAbierto(rec)
          setEstado('en_ruta')
        } else {
          setEstado('disponible')
        }
      } catch {
        setError('Error al verificar el vehículo. Intenta de nuevo.')
      }
    }

    verificar()
  }, [codigo])

  if (estado === 'cargando') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <Loading texto="Verificando vehículo..." />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-blue-600 text-white px-4 py-5 shadow">
        <button onClick={() => router.push('/')} className="text-blue-200 text-sm mb-2">
          ← Volver
        </button>
        <h1 className="text-xl font-bold">{codigo}</h1>
        {vehiculo && (
          <p className="text-blue-200 text-sm">
            {[vehiculo.apodo, vehiculo.marca, vehiculo.modelo].filter(Boolean).join(' · ')}
          </p>
        )}
      </header>

      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full space-y-4">
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {estado === 'no_encontrado' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center space-y-3">
            <span className="text-5xl">❓</span>
            <p className="font-semibold text-gray-800">Vehículo no encontrado</p>
            <p className="text-sm text-gray-500">
              El código <strong>{codigo}</strong> no está registrado en el sistema.
            </p>
            <Button variant="secondary" onClick={() => router.push('/')}>
              Volver al inicio
            </Button>
          </div>
        )}

        {estado === 'disponible' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0" />
              <div>
                <p className="font-semibold text-gray-800">Vehículo disponible</p>
                <p className="text-sm text-gray-500">Sin recorrido activo</p>
              </div>
            </div>
            {vehiculo?.placa && (
              <p className="text-sm text-gray-600">Placa: <strong>{vehiculo.placa}</strong></p>
            )}
            <Button onClick={() => router.push(`/salida?vehiculo=${codigo}`)}>
              Registrar salida
            </Button>
          </div>
        )}

        {estado === 'en_ruta' && recorridoAbierto && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-orange-500 flex-shrink-0 animate-pulse" />
              <div>
                <p className="font-semibold text-gray-800">Vehículo en ruta</p>
                <p className="text-sm text-gray-500">
                  Salida: {formatFecha(recorridoAbierto.fecha_salida)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-gray-500">KM salida</p>
                <p className="font-semibold">{recorridoAbierto.km_salida.toLocaleString()}</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-gray-500">Combustible</p>
                <p className="font-semibold">{combustibleLabel(recorridoAbierto.combustible_salida)}</p>
              </div>
            </div>

            <Button
              onClick={() =>
                router.push(`/regreso?vehiculo=${codigo}&recorrido=${recorridoAbierto.id}`)
              }
            >
              Registrar regreso
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}
