'use client'

// Pantalla principal del módulo de mantenimientos: resumen de alertas
// y cards de acceso a cada apartado (unidades, historial de taller,
// refacciones y otros gastos).

import { useRouter } from 'next/navigation'
import Loading from '@/components/common/Loading'
import { formatMoneda } from '@/utils/formatters'
import { REFACCION_CATEGORIAS } from '@/lib/constants'
import {
  useMantenimientosData,
  MantHeader,
  AvisoMigracion,
  SEMAFORO_UI,
} from './shared'

export default function MantenimientosHub() {
  const router = useRouter()
  const datos = useMantenimientosData()
  const {
    vehiculos, mantenimientos, refacciones, cargando, error,
    requiereMigracion, requiereMigracionRef, semaforoDe,
  } = datos

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando mantenimientos..." />
      </div>
    )
  }

  const activos = vehiculos.filter((v) => v.estado !== 'inactivo')
  const conSemaforo = activos.map((v) => ({ v, info: semaforoDe(v) }))
  const vencidos = conSemaforo.filter(({ info }) => info.semaforo === 'vencido')
  const proximos = conSemaforo.filter(({ info }) => info.semaforo === 'proximo')
  const enTaller = conSemaforo.filter(({ info }) => info.semaforo === 'en_taller')
  const alertas = [...vencidos, ...proximos]

  const totalMant = mantenimientos.reduce((s, m) => s + (m.costo ?? 0), 0)
  const soloRefacciones = refacciones.filter((r) => (r.categoria ?? 'refaccion') === 'refaccion')
  const soloGastos = refacciones.filter((r) => r.categoria === 'gasto')
  const totalRef = soloRefacciones.reduce((s, r) => s + r.costo, 0)
  const totalGastos = soloGastos.reduce((s, r) => s + r.costo, 0)

  const cards = [
    {
      href: '/admin/mantenimientos/calendario',
      emoji: '📅',
      titulo: 'Calendario de mantenimientos',
      descripcion: 'Fechas estimadas del próximo servicio para planear el taller',
      dato:
        vencidos.length > 0
          ? `${vencidos.length} para planear ya`
          : proximos.length > 0
            ? `${proximos.length} en los próximos días`
            : 'Sin servicios cercanos',
      datoClase:
        vencidos.length > 0
          ? 'bg-red-100 text-red-700'
          : proximos.length > 0
            ? 'bg-yellow-100 text-yellow-800'
            : 'bg-green-100 text-green-700',
    },
    {
      href: '/admin/mantenimientos/unidades',
      emoji: '🚦',
      titulo: 'Estado de unidades',
      descripcion: 'Semáforo preventivo cada 10,000 km, ingreso y salida de taller',
      dato:
        vencidos.length > 0
          ? `${vencidos.length} vencida(s)`
          : proximos.length > 0
            ? `${proximos.length} próxima(s)`
            : enTaller.length > 0
              ? `${enTaller.length} en taller`
              : 'Todo al día',
      datoClase:
        vencidos.length > 0
          ? 'bg-red-100 text-red-700'
          : proximos.length > 0
            ? 'bg-yellow-100 text-yellow-800'
            : 'bg-green-100 text-green-700',
    },
    {
      href: '/admin/mantenimientos/historial',
      emoji: '🛠️',
      titulo: 'Historial de taller',
      descripcion: 'Preventivos y correctivos: tiempos, costos y evidencias',
      dato: `${mantenimientos.length} servicio(s) · ${formatMoneda(totalMant)}`,
      datoClase: 'bg-slate-100 text-slate-700',
    },
    {
      href: '/admin/mantenimientos/refacciones',
      emoji: REFACCION_CATEGORIAS.refaccion.emoji,
      titulo: REFACCION_CATEGORIAS.refaccion.labelPlural,
      descripcion: REFACCION_CATEGORIAS.refaccion.descripcion,
      dato: `${soloRefacciones.length} compra(s) · ${formatMoneda(totalRef)}`,
      datoClase: 'bg-slate-100 text-slate-700',
    },
    {
      href: '/admin/mantenimientos/gastos',
      emoji: REFACCION_CATEGORIAS.gasto.emoji,
      titulo: REFACCION_CATEGORIAS.gasto.labelPlural,
      descripcion: REFACCION_CATEGORIAS.gasto.descripcion,
      dato: `${soloGastos.length} gasto(s) · ${formatMoneda(totalGastos)}`,
      datoClase: 'bg-slate-100 text-slate-700',
    },
  ]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <MantHeader
        titulo="Mantenimientos"
        subtitulo="Preventivos, correctivos, refacciones y gastos"
        backHref="/admin"
      />

      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {requiereMigracion && <AvisoMigracion script="mejoras_fase4_mantenimientos.sql" />}
        {!requiereMigracion && requiereMigracionRef && (
          <AvisoMigracion script="mejoras_fase5_refacciones.sql" />
        )}

        {/* Alertas activas */}
        {alertas.length > 0 && (
          <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-4 space-y-2">
            <p className="text-sm font-bold text-red-700">⚠️ Alertas de mantenimiento</p>
            {alertas.map(({ v, info }) => (
              <button
                key={v.codigo}
                onClick={() => router.push('/admin/mantenimientos/unidades')}
                className="w-full text-sm text-gray-700 flex items-center justify-between gap-2 text-left"
              >
                <span>
                  <strong>{v.codigo}</strong>
                  {v.apodo && <span className="text-gray-500"> · {v.apodo}</span>}:{' '}
                  {info.semaforo === 'vencido'
                    ? `vencido por ${Math.abs(info.faltanKm!).toLocaleString()} km`
                    : `faltan ${info.faltanKm!.toLocaleString()} km`}
                </span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${SEMAFORO_UI[info.semaforo].badge}`}>
                  {SEMAFORO_UI[info.semaforo].label}
                </span>
              </button>
            ))}
            <p className="text-xs text-gray-400 pt-1">
              Estas alertas también se envían por WhatsApp al administrador: una semana antes
              (según el ritmo de km de la unidad) y 2 veces al día cuando el servicio está
              vencido, hasta registrar el ingreso a taller.
            </p>
          </div>
        )}

        {/* Cards de acceso */}
        {cards.map((c) => (
          <button
            key={c.href}
            onClick={() => router.push(c.href)}
            className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4 hover:border-gray-300 transition-colors"
          >
            <span className="text-3xl shrink-0">{c.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-900">{c.titulo}</p>
              <p className="text-sm text-gray-500">{c.descripcion}</p>
              <span className={`inline-block mt-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${c.datoClase}`}>
                {c.dato}
              </span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}

        <p className="text-xs text-gray-400 text-center pt-2">
          El programa preventivo corre cada 10,000 km contados desde el km 0
          (servicios a los 10,000 · 20,000 · 30,000...).
        </p>
      </main>
    </div>
  )
}
