'use client'

// Calendario de mantenimientos: coloca cada unidad activa en la fecha
// estimada de su próximo servicio preventivo (según el ritmo de km de
// los últimos 30 días) para poder planear el trabajo del taller.
// Las unidades vencidas se marcan en el día de hoy.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Vehiculo } from '@/lib/supabase'
import Loading from '@/components/common/Loading'
import { MANTENIMIENTO_VENTANA_KM_DIARIO_DIAS } from '@/lib/constants'
import {
  useMantenimientosData,
  MantHeader,
  AvisoMigracion,
  SEMAFORO_UI,
  diasEnTaller,
  type SemaforoInfo,
} from '../shared'

// ── Helpers de fecha (solo día, sin hora) ──────────────────
function soloDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function claveDia(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

function formatDiaLargo(d: Date): string {
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  return `${dias[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()}`
}

// ── Evento del calendario ──────────────────────────────────
interface EventoMantenimiento {
  vehiculo: Vehiculo
  info: SemaforoInfo
  // Día en que se coloca en el calendario (vencidos = hoy)
  fecha: Date
  kmDiario: number
}

export default function CalendarioView() {
  const router = useRouter()
  const datos = useMantenimientosData()
  const {
    vehiculos, cargando, error, requiereMigracion,
    semaforoDe, mantenimientoEnTaller, kmDiario,
  } = datos

  const hoy = soloDia(new Date())
  const [mesVista, setMesVista] = useState(() => new Date(hoy.getFullYear(), hoy.getMonth(), 1))
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(claveDia(hoy))

  // Clasificación de unidades activas
  const { eventos, enTaller, sinEstimacion } = useMemo(() => {
    const eventos: EventoMantenimiento[] = []
    const enTaller: { v: Vehiculo; info: SemaforoInfo }[] = []
    const sinEstimacion: { v: Vehiculo; info: SemaforoInfo }[] = []

    for (const v of vehiculos) {
      if (v.estado === 'inactivo') continue
      const info = semaforoDe(v)
      const ritmo = kmDiario[v.codigo] ?? 0
      if (info.semaforo === 'en_taller') {
        enTaller.push({ v, info })
      } else if (info.semaforo === 'vencido') {
        // Ya le tocaba: se planea para hoy
        eventos.push({ vehiculo: v, info, fecha: hoy, kmDiario: ritmo })
      } else if (info.fechaEstimada) {
        eventos.push({ vehiculo: v, info, fecha: soloDia(info.fechaEstimada), kmDiario: ritmo })
      } else if (info.semaforo !== 'sin_programa') {
        // Con programa pero sin ritmo de km: no hay fecha estimable
        sinEstimacion.push({ v, info })
      }
    }
    eventos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
    return { eventos, enTaller, sinEstimacion }
    // hoy se recalcula en cada render pero su valor-día es estable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiculos, semaforoDe, kmDiario])

  const eventosPorDia = useMemo(() => {
    const mapa: Record<string, EventoMantenimiento[]> = {}
    for (const e of eventos) {
      const k = claveDia(e.fecha)
      ;(mapa[k] ??= []).push(e)
    }
    return mapa
  }, [eventos])

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Cargando calendario..." />
      </div>
    )
  }

  // ── Celdas del mes en vista ──────────────────────────────
  const anio = mesVista.getFullYear()
  const mes = mesVista.getMonth()
  const primerDia = new Date(anio, mes, 1)
  const diasEnMes = new Date(anio, mes + 1, 0).getDate()
  // Lunes = 0 ... Domingo = 6
  const offsetInicio = (primerDia.getDay() + 6) % 7

  const celdas: (Date | null)[] = [
    ...Array.from({ length: offsetInicio }, () => null),
    ...Array.from({ length: diasEnMes }, (_, i) => new Date(anio, mes, i + 1)),
  ]
  while (celdas.length % 7 !== 0) celdas.push(null)

  const esMesActual = anio === hoy.getFullYear() && mes === hoy.getMonth()
  const eventosDelDia = diaSeleccionado ? (eventosPorDia[diaSeleccionado] ?? []) : []

  // Próximos 3 meses para la lista de abajo
  const proximos = eventos.filter(
    (e) => e.fecha.getTime() <= hoy.getTime() + 92 * 24 * 3600 * 1000
  )

  function cambiarMes(delta: number) {
    setMesVista(new Date(anio, mes + delta, 1))
    setDiaSeleccionado(null)
  }

  function irAHoy() {
    setMesVista(new Date(hoy.getFullYear(), hoy.getMonth(), 1))
    setDiaSeleccionado(claveDia(hoy))
  }

  function seleccionarDia(d: Date) {
    const k = claveDia(d)
    setDiaSeleccionado((prev) => (prev === k ? null : k))
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <MantHeader
        titulo="Calendario de mantenimientos"
        subtitulo="Fechas estimadas del próximo servicio por unidad"
        backHref="/admin/mantenimientos"
      />

      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {requiereMigracion && <AvisoMigracion script="mejoras_fase4_mantenimientos.sql" />}

        {/* ── Calendario mensual ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          {/* Navegación de mes */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => cambiarMes(-1)}
              className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50"
              aria-label="Mes anterior"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="text-center">
              <p className="font-bold text-gray-900">{MESES[mes]} {anio}</p>
              {!esMesActual && (
                <button onClick={irAHoy} className="text-xs text-slate-500 underline">
                  Volver a hoy
                </button>
              )}
            </div>
            <button
              onClick={() => cambiarMes(1)}
              className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50"
              aria-label="Mes siguiente"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Encabezado de días */}
          <div className="grid grid-cols-7 mb-1">
            {DIAS_SEMANA.map((d, i) => (
              <div key={i} className="text-center text-xs font-semibold text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* Celdas */}
          <div className="grid grid-cols-7 gap-1">
            {celdas.map((d, i) => {
              if (!d) return <div key={i} />
              const k = claveDia(d)
              const evs = eventosPorDia[k] ?? []
              const esHoy = k === claveDia(hoy)
              const seleccionado = k === diaSeleccionado
              const tieneVencido = evs.some((e) => e.info.semaforo === 'vencido')
              const tieneProximo = evs.some((e) => e.info.semaforo === 'proximo')
              return (
                <button
                  key={i}
                  onClick={() => seleccionarDia(d)}
                  className={[
                    'relative aspect-square rounded-xl flex flex-col items-center justify-center text-sm transition-colors',
                    seleccionado
                      ? 'bg-slate-700 text-white font-bold'
                      : esHoy
                        ? 'bg-slate-100 text-slate-900 font-bold ring-1 ring-slate-300'
                        : evs.length > 0
                          ? tieneVencido
                            ? 'bg-red-50 text-red-800 font-semibold hover:bg-red-100'
                            : tieneProximo
                              ? 'bg-yellow-50 text-yellow-800 font-semibold hover:bg-yellow-100'
                              : 'bg-green-50 text-green-800 font-semibold hover:bg-green-100'
                          : 'text-gray-600 hover:bg-gray-50',
                  ].join(' ')}
                >
                  {d.getDate()}
                  {evs.length > 0 && (
                    <span className="flex gap-0.5 mt-0.5">
                      {evs.slice(0, 3).map((e, j) => (
                        <span
                          key={j}
                          className={`w-1.5 h-1.5 rounded-full ${
                            seleccionado ? 'bg-white' : SEMAFORO_UI[e.info.semaforo].barra
                          }`}
                        />
                      ))}
                      {evs.length > 3 && (
                        <span className={`text-[9px] leading-none font-bold ${seleccionado ? 'text-white' : 'text-gray-500'}`}>
                          +{evs.length - 3}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Leyenda */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-gray-100">
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-red-500" /> Vencido (planear ya)
            </span>
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-yellow-400" /> Próximo
            </span>
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-green-500" /> Estimado
            </span>
          </div>
        </div>

        {/* ── Detalle del día seleccionado ── */}
        {diaSeleccionado && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <p className="text-sm font-bold text-gray-900 capitalize">
              {formatDiaLargo(new Date(diaSeleccionado + 'T00:00:00'))}
            </p>
            {eventosDelDia.length === 0 ? (
              <p className="text-sm text-gray-400">Sin mantenimientos estimados para este día.</p>
            ) : (
              eventosDelDia.map((e) => <EventoCard key={e.vehiculo.codigo} evento={e} onClick={() => router.push('/admin/mantenimientos/unidades')} />)
            )}
          </div>
        )}

        {/* ── Lista cronológica de próximos servicios ── */}
        {proximos.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <p className="text-sm font-bold text-gray-900">📋 Próximos servicios (3 meses)</p>
            {proximos.map((e) => (
              <EventoCard
                key={e.vehiculo.codigo}
                evento={e}
                conFecha
                onClick={() => {
                  setMesVista(new Date(e.fecha.getFullYear(), e.fecha.getMonth(), 1))
                  setDiaSeleccionado(claveDia(e.fecha))
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              />
            ))}
          </div>
        )}

        {/* ── En taller ── */}
        {enTaller.length > 0 && (
          <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4 space-y-2">
            <p className="text-sm font-bold text-amber-800">🔧 Actualmente en taller</p>
            {enTaller.map(({ v }) => {
              const m = mantenimientoEnTaller(v.codigo)
              return (
                <button
                  key={v.codigo}
                  onClick={() => router.push('/admin/mantenimientos/unidades')}
                  className="w-full text-left text-sm text-gray-700 flex items-center justify-between gap-2"
                >
                  <span>
                    <strong>{v.codigo}</strong>
                    {v.apodo && <span className="text-gray-500"> · {v.apodo}</span>}
                    {m && <span className="text-gray-500"> — {m.descripcion}</span>}
                  </span>
                  {m && (
                    <span className="text-xs text-amber-700 font-semibold shrink-0">
                      {diasEnTaller(m)} día(s)
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* ── Sin estimación ── */}
        {sinEstimacion.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
            <p className="text-sm font-bold text-gray-700">❔ Sin fecha estimable</p>
            <p className="text-xs text-gray-400">
              Estas unidades no registran recorridos en los últimos {MANTENIMIENTO_VENTANA_KM_DIARIO_DIAS} días,
              por lo que no hay ritmo de km para estimar su fecha de servicio.
            </p>
            {sinEstimacion.map(({ v, info }) => (
              <div key={v.codigo} className="text-sm text-gray-700 flex items-center justify-between gap-2">
                <span>
                  <strong>{v.codigo}</strong>
                  {v.apodo && <span className="text-gray-500"> · {v.apodo}</span>}
                </span>
                <span className="text-xs text-gray-500 shrink-0">
                  faltan {info.faltanKm?.toLocaleString()} km
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-400 text-center pt-2 pb-4">
          Las fechas son aproximadas: se estiman con el promedio de km diarios de cada unidad
          en los últimos {MANTENIMIENTO_VENTANA_KM_DIARIO_DIAS} días y se recalculan solas
          conforme se registran recorridos.
        </p>
      </main>
    </div>
  )
}

// ── Card de un servicio estimado ───────────────────────────
function EventoCard({
  evento,
  conFecha = false,
  onClick,
}: {
  evento: EventoMantenimiento
  conFecha?: boolean
  onClick: () => void
}) {
  const { vehiculo: v, info, fecha, kmDiario } = evento
  const vencido = info.semaforo === 'vencido'
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-gray-100 hover:border-gray-300 transition-colors p-3 flex items-center gap-3"
    >
      <span
        className={`w-1.5 self-stretch rounded-full shrink-0 ${SEMAFORO_UI[info.semaforo].barra}`}
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-gray-900 text-sm">
          {v.codigo}
          {v.apodo && <span className="text-gray-500 font-normal"> · {v.apodo}</span>}
          {v.placa && <span className="text-gray-400 font-normal text-xs"> ({v.placa})</span>}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {vencido ? (
            <>Servicio a los {info.proximoKm?.toLocaleString()} km — vencido por {Math.abs(info.faltanKm ?? 0).toLocaleString()} km</>
          ) : (
            <>
              Servicio a los {info.proximoKm?.toLocaleString()} km — faltan {info.faltanKm?.toLocaleString()} km
              {kmDiario > 0 && <> (~{Math.round(kmDiario)} km/día)</>}
            </>
          )}
        </p>
        {conFecha && (
          <p className={`text-xs font-semibold mt-0.5 ${vencido ? 'text-red-600' : 'text-gray-600'}`}>
            {vencido ? '🔴 Planear de inmediato' : `≈ ${formatDiaLargo(fecha)}`}
          </p>
        )}
      </div>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${SEMAFORO_UI[info.semaforo].badge}`}>
        {SEMAFORO_UI[info.semaforo].label}
      </span>
    </button>
  )
}
