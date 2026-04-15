'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Button from '@/components/common/Button'

export default function HomePage() {
  const router = useRouter()
  const [codigoManual, setCodigoManual] = useState('')

  function handleManual(e: React.FormEvent) {
    e.preventDefault()
    const codigo = codigoManual.trim().toUpperCase()
    if (codigo) router.push(`/vehiculo/${codigo}`)
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-blue-600 text-white px-4 py-5 text-center shadow">
        <h1 className="text-xl font-bold tracking-tight">Control de Recorridos</h1>
        <p className="text-blue-200 text-sm mt-0.5">Escanea el QR del vehículo para comenzar</p>
      </header>

      <main className="flex-1 flex flex-col gap-6 px-4 py-6 max-w-md mx-auto w-full">
        {/* Instrucción QR */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center space-y-3">
          <span className="text-6xl">📱</span>
          <p className="text-gray-700 font-medium">Escanea el código QR del vehículo</p>
          <p className="text-gray-500 text-sm">
            Abre la cámara de tu celular y apunta al código QR pegado en el vehículo. Te llevará directo al registro.
          </p>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 text-gray-400 text-sm">
          <div className="flex-1 h-px bg-gray-200" />
          <span>o ingresa el código manualmente</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Entrada manual */}
        <form onSubmit={handleManual} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
          <label htmlFor="codigo-manual" className="block text-sm font-medium text-gray-700">
            Código del vehículo
          </label>
          <input
            id="codigo-manual"
            type="text"
            value={codigoManual}
            onChange={(e) => setCodigoManual(e.target.value)}
            placeholder="Ej: VH-001"
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base uppercase placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoCapitalize="characters"
          />
          <Button type="submit" variant="secondary" disabled={!codigoManual.trim()}>
            Buscar vehículo
          </Button>
        </form>
      </main>

      {/* Bottom nav */}
      <nav className="border-t border-gray-200 bg-white px-4 py-3 flex justify-around">
        <a href="/historico" className="flex flex-col items-center gap-0.5 text-gray-500 hover:text-blue-600 text-xs">
          <span className="text-xl">📋</span>
          Histórico
        </a>
        <a href="/indicadores" className="flex flex-col items-center gap-0.5 text-gray-500 hover:text-blue-600 text-xs">
          <span className="text-xl">📊</span>
          Indicadores
        </a>
      </nav>
    </div>
  )
}
