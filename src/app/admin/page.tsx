'use client'

import { useRouter } from 'next/navigation'
import PasswordGate from '@/components/common/PasswordGate'

const SECCIONES = [
  {
    href: '/admin/recorridos',
    emoji: '🛣️',
    titulo: 'Recorridos',
    descripcion: 'Editar recorridos y paradas, reabrir o cerrar',
    proximamente: false,
  },
  {
    href: '/admin/vehiculos',
    emoji: '🚗',
    titulo: 'Vehículos',
    descripcion: 'Catálogo, resguardo y ubicación de unidades',
    proximamente: false,
  },
  {
    href: '/admin/conductores',
    emoji: '🧑‍✈️',
    titulo: 'Conductores',
    descripcion: 'Catálogo de conductores y eventuales',
    proximamente: false,
  },
  {
    href: '/admin/mantenimientos',
    emoji: '🔧',
    titulo: 'Mantenimientos',
    descripcion: 'Preventivos cada 10,000 km, correctivos, refacciones y gastos',
    proximamente: false,
  },
  {
    href: '/admin/gastos',
    emoji: '💰',
    titulo: 'Gastos',
    descripcion: 'Gasto total y por unidad: combustible, mantenimientos y refacciones',
    proximamente: false,
  },
  {
    href: '/admin/cargas-gasolina',
    emoji: '⛽',
    titulo: 'Cargas de gasolina',
    descripcion: 'Revisión y depuración de cargas',
    proximamente: false,
  },
  {
    href: '/solicitudes',
    emoji: '📨',
    titulo: 'Solicitudes de combustible',
    descripcion: 'Autorizar, rechazar y cargar en Edenred',
    proximamente: false,
  },
  {
    href: '/admin/historial',
    emoji: '🕒',
    titulo: 'Historial de cambios',
    descripcion: 'Ediciones y eliminaciones administrativas de todos los módulos',
    proximamente: false,
  },
] as const

export default function AdminHubPage() {
  const router = useRouter()

  return (
    <PasswordGate title="Administración">
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-gray-800 text-white px-4 py-5 shadow flex items-center gap-3">
          <button
            onClick={() => router.push('/')}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Volver al inicio"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Administración</h1>
            <p className="text-gray-400 text-sm mt-0.5">Panel de gestión de la flotilla</p>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-3">
          {SECCIONES.map((s) =>
            s.proximamente ? (
              <div
                key={s.href}
                className="w-full text-left bg-gray-50 rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4 cursor-not-allowed"
                aria-disabled="true"
              >
                <span className="text-3xl shrink-0 opacity-40 grayscale">{s.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-400">{s.titulo}</p>
                  <p className="text-sm text-gray-400">{s.descripcion}</p>
                </div>
                <span className="text-xs font-semibold text-gray-500 bg-gray-200 rounded-full px-2.5 py-1 shrink-0">
                  Próximamente
                </span>
              </div>
            ) : (
              <button
                key={s.href}
                onClick={() => router.push(s.href)}
                className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4 hover:border-gray-300 transition-colors"
              >
                <span className="text-3xl shrink-0">{s.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900">{s.titulo}</p>
                  <p className="text-sm text-gray-500">{s.descripcion}</p>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )
          )}
        </main>
      </div>
    </PasswordGate>
  )
}
