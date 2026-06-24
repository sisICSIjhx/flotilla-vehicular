'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { calcKmRecorridos, calcLitrosConsumidos, calcRendimiento } from '@/lib/calculations'
import { formatFecha, formatMoneda, formatDecimal } from '@/utils/formatters'
import { combustibleLabel } from '@/lib/constants'
import { getPublicUrl, getPublicUrlCarga } from '@/utils/storage'
import Loading from '@/components/common/Loading'
import ErrorMessage from '@/components/common/ErrorMessage'
import ExportButtons from '@/components/common/ExportButtons'
import {
  type CargaGasolina,
  type FuelMap,
  type RecorridoHistorico,
  type TipoCarga,
  type VistaActiva,
} from './types'
import {
  aplicarFiltrosRecorridos,
  contarRecorridos,
  fetchRecorridosCompletos,
  exportarRecorridosCsv,
  exportarRecorridosXlsx,
  exportarRecorridosPdf,
  exportarCargasCsv,
  exportarCargasXlsx,
  exportarCargasPdf,
} from './exportHistorico'

const PAGINA_TAMAÑO = 50

function Paginacion({ pagina, total, onChange }: { pagina: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null

  const items: (number | '...')[] = []
  if (total <= 7) {
    for (let i = 1; i <= total; i++) items.push(i)
  } else {
    items.push(1)
    if (pagina > 3) items.push('...')
    for (let i = Math.max(2, pagina - 1); i <= Math.min(total - 1, pagina + 1); i++) items.push(i)
    if (pagina < total - 2) items.push('...')
    items.push(total)
  }

  return (
    <div className="flex items-center justify-center gap-1 py-3">
      <button
        onClick={() => onChange(pagina - 1)}
        disabled={pagina === 1}
        className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Página anterior"
      >
        ‹
      </button>
      {items.map((p, i) =>
        p === '...' ? (
          <span key={`e${i}`} className="w-9 h-9 flex items-center justify-center text-gray-400 text-sm select-none">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p as number)}
            className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition-colors ${
              p === pagina
                ? 'bg-blue-600 text-white shadow-sm'
                : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onChange(pagina + 1)}
        disabled={pagina === total}
        className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Página siguiente"
      >
        ›
      </button>
    </div>
  )
}

export default function HistoricoView() {
  const router = useRouter()

  // ── Vista activa ──────────────────────────────────────────────────────────
  const [vistaActiva, setVistaActiva] = useState<VistaActiva>('recorridos')

  // ── Estado: Recorridos ────────────────────────────────────────────────────
  const [registros, setRegistros] = useState<RecorridoHistorico[]>([])
  const [vehiculos, setVehiculos] = useState<{ codigo: string; placa: string | null; apodo: string | null }[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtroVehiculo, setFiltroVehiculo] = useState('')
  const [fotoModal, setFotoModal] = useState<{ url: string; titulo: string } | null>(null)
  const [paradasModal, setParadasModal] = useState<RecorridoHistorico | null>(null)
  const [cargasPorRecorrido, setCargasPorRecorrido] = useState<FuelMap>(new Map())

  // ── Estado: Recorridos (filtros de fecha y conductor) ─────────────────────
  const hoy = new Date()
  const defaultFechaInicioRec = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
  const defaultFechaFinRec = format(hoy, 'yyyy-MM-dd')

  const [filtroFechaInicioRec, setFiltroFechaInicioRec] = useState(defaultFechaInicioRec)
  const [filtroFechaFinRec, setFiltroFechaFinRec] = useState(defaultFechaFinRec)
  const [filtroConductorRec, setFiltroConductorRec] = useState('')

  // ── Estado: Cargas de gasolina ────────────────────────────────────────────
  const defaultFechaInicio = `${hoy.getFullYear()}-05-01`
  const defaultFechaFin = format(hoy, 'yyyy-MM-dd')

  const [cargas, setCargas] = useState<CargaGasolina[]>([])
  const [cargandoCargas, setCargandoCargas] = useState(false)
  const [errorCargas, setErrorCargas] = useState<string | null>(null)
  const [filtroFechaInicio, setFiltroFechaInicio] = useState(defaultFechaInicio)
  const [filtroFechaFin, setFiltroFechaFin] = useState(defaultFechaFin)
  const [filtroVehiculoCargas, setFiltroVehiculoCargas] = useState('')
  const [filtroConductorCargas, setFiltroConductorCargas] = useState('')
  const [filtroTipoCarga, setFiltroTipoCarga] = useState<TipoCarga>('todas')

  // ── Paginación ────────────────────────────────────────────────────────────
  const [paginaRec, setPaginaRec] = useState(1)
  const [paginaCargas, setPaginaCargas] = useState(1)

  // ── Efectos ───────────────────────────────────────────────────────────────
  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroVehiculo, filtroFechaInicioRec, filtroFechaFinRec])

  useEffect(() => {
    if (vistaActiva === 'cargas') {
      cargarCargas()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vistaActiva, filtroFechaInicio, filtroFechaFin, filtroVehiculoCargas])

  // ── Carga de recorridos ───────────────────────────────────────────────────
  async function cargar() {
    setCargando(true)
    setError(null)
    setPaginaRec(1)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase.from('recorridos') as any)
        .select(`
          id, vehiculo_codigo, estado, usa_paradas, fecha_salida, fecha_regreso,
          km_salida, km_regreso, combustible_salida, combustible_regreso,
          foto_salida_path, foto_regreso_path,
          conductores(nombre),
          centros_costo(nombre),
          vehiculos(capacidad_tanque_litros, placa, apodo),
          recorridos_paradas(id, orden, estado, km_parada, combustible_parada, foto_parada_path, centros_costo(nombre))
        `)
        .order('fecha_salida', { ascending: false })

      query = aplicarFiltrosRecorridos(query, filtroVehiculo, filtroFechaInicioRec, filtroFechaFinRec)

      const { data, error: qError } = await query
      if (qError) throw new Error(qError.message)

      const rows = (data ?? []) as RecorridoHistorico[]
      setRegistros(rows)

      const unicos = [
        ...new Map(rows.map((r) => [r.vehiculo_codigo, { codigo: r.vehiculo_codigo, placa: r.vehiculos?.placa ?? null, apodo: r.vehiculos?.apodo ?? null }])).values(),
      ].sort((a, b) => a.codigo.localeCompare(b.codigo))
      setVehiculos(unicos)

      // Batch fetch fuel sums from cargas_gasolina
      if (rows.length > 0) {
        try {
          const ids = rows.map((r) => r.id)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: cargasData } = await (supabase.from('cargas_gasolina') as any)
            .select('recorrido_id, litros_cargados, precio_litro')
            .in('recorrido_id', ids)

          const fuelMap: FuelMap = new Map()
          for (const c of (cargasData ?? [])) {
            const prev = fuelMap.get(c.recorrido_id) ?? { litros: 0, costo: 0 }
            fuelMap.set(c.recorrido_id, {
              litros: prev.litros + Number(c.litros_cargados),
              costo: prev.costo + Number(c.litros_cargados) * Number(c.precio_litro),
            })
          }
          setCargasPorRecorrido(fuelMap)
        } catch {
          // tabla aún no existe — sin datos de combustible
          setCargasPorRecorrido(new Map())
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar histórico')
    } finally {
      setCargando(false)
    }
  }

  // ── Carga de cargas de gasolina ───────────────────────────────────────────
  async function cargarCargas() {
    setCargandoCargas(true)
    setErrorCargas(null)
    setPaginaCargas(1)

    try {
      const fechaInicioISO = new Date(filtroFechaInicio + 'T00:00:00').toISOString()
      const fechaFinISO = new Date(filtroFechaFin + 'T23:59:59').toISOString()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase.from('cargas_gasolina') as any)
        .select(`
          id, vehiculo_codigo, recorrido_id, km_antes, km_despues,
          combustible_antes, combustible_despues,
          litros_cargados, precio_litro,
          foto_tablero_antes_path, foto_tablero_despues_path, foto_ticket_path,
          observaciones, created_at,
          conductores(nombre),
          vehiculos(placa, apodo, modelo),
          recorridos(centros_costo(nombre))
        `)
        .gte('created_at', fechaInicioISO)
        .lte('created_at', fechaFinISO)
        .order('created_at', { ascending: true })

      if (filtroVehiculoCargas) {
        query = query.eq('vehiculo_codigo', filtroVehiculoCargas)
      }

      const { data, error: qError } = await query
      if (qError) throw new Error(qError.message)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lista: CargaGasolina[] = ((data ?? []) as any[]).map((c) => ({
        id: c.id,
        vehiculo_codigo: c.vehiculo_codigo,
        placa: c.vehiculos?.placa ?? null,
        apodo: c.vehiculos?.apodo ?? null,
        modelo: c.vehiculos?.modelo ?? null,
        conductor: c.conductores?.nombre ?? '—',
        recorrido_id: c.recorrido_id,
        destino: c.recorridos?.centros_costo?.nombre ?? null,
        km_antes: c.km_antes,
        km_despues: c.km_despues,
        combustible_antes: c.combustible_antes,
        combustible_despues: c.combustible_despues,
        litros_cargados: Number(c.litros_cargados),
        precio_litro: Number(c.precio_litro),
        costo_total: Number(c.litros_cargados) * Number(c.precio_litro),
        foto_tablero_antes_path: c.foto_tablero_antes_path,
        foto_tablero_despues_path: c.foto_tablero_despues_path,
        foto_ticket_path: c.foto_ticket_path,
        observaciones: c.observaciones,
        fecha_carga: c.created_at,
        fecha_siguiente_carga: null,
        km_siguiente_carga: null,
      }))

      // LEAD: siguiente carga del mismo vehículo (lista ya viene ordenada por fecha asc)
      const conSiguiente: CargaGasolina[] = lista.map((item, idx) => {
        const next = lista[idx + 1]
        const tieneSiguiente = next && next.vehiculo_codigo === item.vehiculo_codigo
        return {
          ...item,
          fecha_siguiente_carga: tieneSiguiente ? next.fecha_carga : null,
          km_siguiente_carga: tieneSiguiente ? next.km_despues : null,
        }
      })

      // Más reciente primero para display
      conSiguiente.sort((a, b) => new Date(b.fecha_carga).getTime() - new Date(a.fecha_carga).getTime())

      setCargas(conSiguiente)
    } catch (err) {
      setErrorCargas(err instanceof Error ? err.message : 'Error al cargar cargas de gasolina')
    } finally {
      setCargandoCargas(false)
    }
  }

  // ── Filtro conductor client-side ──────────────────────────────────────────
  const conductoresRec = [...new Set(registros.map((r) => r.conductores?.nombre ?? '').filter(Boolean))].sort()
  const registrosDisplay = filtroConductorRec
    ? registros.filter((r) => r.conductores?.nombre === filtroConductorRec)
    : registros
  const totalPaginasRec = Math.ceil(registrosDisplay.length / PAGINA_TAMAÑO)
  const registrosPaginados = registrosDisplay.slice((paginaRec - 1) * PAGINA_TAMAÑO, paginaRec * PAGINA_TAMAÑO)

  // ── Totales recorridos ────────────────────────────────────────────────────
  const cerrados = registrosDisplay.filter((r) => r.estado === 'cerrado')
  const totalKm = cerrados.reduce(
    (acc, r) => acc + (r.km_regreso != null ? calcKmRecorridos(r.km_salida, r.km_regreso) : 0),
    0
  )
  const totalCosto = cerrados.reduce((acc, r) => acc + (cargasPorRecorrido.get(r.id)?.costo ?? 0), 0)

  // ── Totales y filtros cargas ──────────────────────────────────────────────
  const cargasFiltradas = cargas.filter((c) => {
    if (filtroConductorCargas && c.conductor !== filtroConductorCargas) return false
    if (filtroTipoCarga === 'en_recorrido' && !c.recorrido_id) return false
    if (filtroTipoCarga === 'fuera_recorrido' && c.recorrido_id) return false
    return true
  })
  const totalPaginasCargas = Math.ceil(cargasFiltradas.length / PAGINA_TAMAÑO)
  const cargasPaginadas = cargasFiltradas.slice((paginaCargas - 1) * PAGINA_TAMAÑO, paginaCargas * PAGINA_TAMAÑO)

  const vehiculosCargas = [
    ...new Map(cargas.map((c) => [c.vehiculo_codigo, { codigo: c.vehiculo_codigo, placa: c.placa }])).values(),
  ].sort((a, b) => a.codigo.localeCompare(b.codigo))
  const conductoresCargas = [...new Set(cargas.map((c) => c.conductor))].filter((n) => n !== '—').sort()

  const totalPesosCargas = cargasFiltradas.reduce((acc, c) => acc + c.costo_total, 0)
  const totalLitrosCargas = cargasFiltradas.reduce((acc, c) => acc + c.litros_cargados, 0)
  const promedioPrecioLitro = totalLitrosCargas > 0 ? totalPesosCargas / totalLitrosCargas : 0

  // ── Exportación ───────────────────────────────────────────────────────────
  // La tabla muestra máximo 50, pero la descarga trae TODOS los registros
  // que coinciden con los filtros. Con el período "Todo" se confirma antes
  // para evitar descargas enormes accidentales.
  async function obtenerRecorridosParaExportar(): Promise<{ registros: RecorridoHistorico[]; fuelMap: FuelMap } | null> {
    const total = await contarRecorridos(filtroVehiculo, filtroFechaInicioRec, filtroFechaFinRec)
    if (total > 200) {
      const continuar = window.confirm(
        `El filtro actual incluye ${total.toLocaleString()} recorridos. ` +
        `¿Descargar todos? Para un archivo más pequeño, ajusta el rango de fechas.`
      )
      if (!continuar) return null
    }
    const { registros: todos, fuelMap } = await fetchRecorridosCompletos(filtroVehiculo, filtroFechaInicioRec, filtroFechaFinRec)
    const filtrados = filtroConductorRec
      ? todos.filter((r) => r.conductores?.nombre === filtroConductorRec)
      : todos
    if (filtrados.length === 0) throw new Error('No hay registros para exportar con los filtros actuales')
    return { registros: filtrados, fuelMap }
  }

  async function exportarRecorridos(formato: 'csv' | 'xlsx' | 'pdf') {
    const result = await obtenerRecorridosParaExportar()
    if (!result) return
    const { registros, fuelMap } = result
    if (formato === 'csv') exportarRecorridosCsv(registros, fuelMap)
    else if (formato === 'xlsx') exportarRecorridosXlsx(registros, fuelMap)
    else exportarRecorridosPdf(registros, fuelMap, filtroVehiculo, filtroConductorRec, filtroFechaInicioRec, filtroFechaFinRec)
  }

  function exportarCargas(formato: 'csv' | 'xlsx' | 'pdf') {
    if (cargasFiltradas.length === 0) {
      throw new Error('No hay cargas para exportar con los filtros actuales')
    }
    if (formato === 'csv') exportarCargasCsv(cargasFiltradas)
    else if (formato === 'xlsx') exportarCargasXlsx(cargasFiltradas)
    else {
      exportarCargasPdf(cargasFiltradas, {
        fechaInicio: filtroFechaInicio,
        fechaFin: filtroFechaFin,
        vehiculo: filtroVehiculoCargas,
        conductor: filtroConductorCargas,
        tipo:
          filtroTipoCarga === 'todas'
            ? 'Todos los tipos'
            : filtroTipoCarga === 'en_recorrido'
              ? 'En recorrido'
              : 'Fuera de recorrido',
      })
    }
  }

  function formatTiempoEntre(fecha1: string, fecha2: string): string {
    const diffMs = new Date(fecha2).getTime() - new Date(fecha1).getTime()
    if (diffMs <= 0) return '—'
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
    const days = Math.floor(totalHours / 24)
    const hours = totalHours % 24
    if (days > 0) return `${days}d ${hours}h`
    return `${hours}h`
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col">

      {/* Modal de foto */}
      {fotoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setFotoModal(null)}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            className="relative z-10 max-w-2xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white rounded-2xl overflow-hidden shadow-2xl">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <span className="text-sm font-semibold text-gray-700">{fotoModal.titulo}</span>
                <button
                  onClick={() => setFotoModal(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-lg font-bold"
                >
                  ✕
                </button>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fotoModal.url}
                alt={fotoModal.titulo}
                className="w-full object-contain max-h-[75vh]"
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal de paradas */}
      {paradasModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setParadasModal(null)}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            className="relative z-10 w-full max-w-lg max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
                <div>
                  <p className="text-sm font-bold text-gray-800">
                    {paradasModal.vehiculo_codigo}{paradasModal.vehiculos?.placa ? ` — ${paradasModal.vehiculos.placa}` : ''} — Paradas del recorrido
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatFecha(paradasModal.fecha_salida)}</p>
                </div>
                <button
                  onClick={() => setParadasModal(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-lg font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="overflow-y-auto divide-y divide-gray-100">
                {[...paradasModal.recorridos_paradas]
                  .sort((a, b) => a.orden - b.orden)
                  .map((p) => (
                    <div key={p.id} className="px-4 py-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
                            {p.orden}
                          </span>
                          <span className="text-sm font-semibold text-gray-800">
                            {p.centros_costo?.nombre ?? 'Centro de costo no registrado'}
                          </span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          p.estado === 'completada'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {p.estado === 'completada' ? 'Completada' : 'Pendiente'}
                        </span>
                      </div>

                      {p.estado === 'completada' && (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs pl-8">
                          {p.km_parada != null && (
                            <div>
                              <span className="text-gray-400">KM parada</span>
                              <span className="ml-1 font-medium text-gray-700">{p.km_parada.toLocaleString()}</span>
                            </div>
                          )}
                          {p.combustible_parada != null && (
                            <div>
                              <span className="text-gray-400">Combustible</span>
                              <span className="ml-1 font-medium text-gray-700">{combustibleLabel(p.combustible_parada)}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {p.foto_parada_path && (
                        <div className="pl-8">
                          <button
                            onClick={() => {
                              setParadasModal(null)
                              setFotoModal({
                                url: getPublicUrl(p.foto_parada_path!),
                                titulo: `Foto parada ${p.orden} — ${paradasModal.vehiculo_codigo}`,
                              })
                            }}
                            className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            Ver foto de parada
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>

              {paradasModal.recorridos_paradas.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 shrink-0">
                  <span className="text-xs text-gray-500">
                    <span className="font-semibold text-gray-700">
                      {paradasModal.recorridos_paradas.filter(p => p.estado === 'completada').length}
                    </span>
                    /{paradasModal.recorridos_paradas.length} completadas
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-blue-600 text-white px-4 py-5 shadow">
        <button onClick={() => router.push('/')} className="text-blue-200 text-sm mb-2">
          ← Inicio
        </button>
        <h1 className="text-xl font-bold">Histórico de recorridos</h1>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-4">
        <div className="flex max-w-5xl mx-auto">
          <button
            onClick={() => setVistaActiva('recorridos')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              vistaActiva === 'recorridos'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Recorridos
          </button>
          <button
            onClick={() => setVistaActiva('cargas')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              vistaActiva === 'cargas'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Cargas de gasolina
          </button>
        </div>
      </div>

      {/* ─── Vista: Recorridos ─────────────────────────────────────────────── */}
      {vistaActiva === 'recorridos' && (
        <div className="px-4 py-4 max-w-5xl mx-auto w-full space-y-4">
          {/* Filtros recorridos */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
            {/* Fechas */}
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">Desde</label>
                <input
                  type="date"
                  value={filtroFechaInicioRec}
                  onChange={(e) => setFiltroFechaInicioRec(e.target.value)}
                  className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">Hasta</label>
                <input
                  type="date"
                  value={filtroFechaFinRec}
                  onChange={(e) => setFiltroFechaFinRec(e.target.value)}
                  className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Vehículo y conductor */}
            <div className="flex flex-wrap gap-3">
              <select
                value={filtroVehiculo}
                onChange={(e) => setFiltroVehiculo(e.target.value)}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todos los vehículos</option>
                {vehiculos.map((v) => (
                  <option key={v.codigo} value={v.codigo}>
                    {v.codigo}{v.placa ? ` — ${v.placa}` : ''}{v.apodo ? ` — ${v.apodo}` : ''}
                  </option>
                ))}
              </select>

              <select
                value={filtroConductorRec}
                onChange={(e) => { setFiltroConductorRec(e.target.value); setPaginaRec(1) }}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todos los conductores</option>
                {conductoresRec.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Exportar recorridos */}
          <ExportButtons
            onCsv={() => exportarRecorridos('csv')}
            onXlsx={() => exportarRecorridos('xlsx')}
            onPdf={() => exportarRecorridos('pdf')}
            deshabilitado={cargando || registrosDisplay.length === 0}
          />

          {/* Resumen recorridos */}
          {!cargando && cerrados.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-3 text-center">
                <p className="text-xs text-gray-500">Recorridos</p>
                <p className="text-lg font-bold text-gray-800">{cerrados.length}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-3 text-center">
                <p className="text-xs text-gray-500">KM totales</p>
                <p className="text-lg font-bold text-gray-800">{totalKm.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-3 text-center">
                <p className="text-xs text-gray-500">Costo total</p>
                <p className="text-lg font-bold text-gray-800">{formatMoneda(totalCosto)}</p>
              </div>
            </div>
          )}

          {error && <ErrorMessage mensaje={error} />}

          {cargando ? (
            <Loading texto="Cargando registros..." />
          ) : registrosDisplay.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <span className="text-4xl">📋</span>
              <p className="mt-2 text-sm">No hay registros para este filtro</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm">
              <table className="min-w-full bg-white text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                    <th className="px-3 py-3 text-center">Vehículo</th>
                    <th className="px-3 py-3 text-left">Conductor</th>
                    <th className="px-3 py-3 text-center">Salida</th>
                    <th className="px-3 py-3 text-center">Regreso</th>
                    <th className="px-3 py-3 text-center">KM sal.</th>
                    <th className="px-3 py-3 text-center">KM reg.</th>
                    <th className="px-3 py-3 text-center">KM rec.</th>
                    <th className="px-3 py-3 text-center">L. recargados</th>
                    <th className="px-3 py-3 text-center">L. consumidos</th>
                    <th className="px-3 py-3 text-center">Costo</th>
                    <th className="px-3 py-3 text-center">Rend.</th>
                    <th className="px-3 py-3 text-center">Paradas</th>
                    <th className="px-3 py-3 text-center">Foto sal.</th>
                    <th className="px-3 py-3 text-center">Foto reg.</th>
                    <th className="px-3 py-3 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {registrosPaginados.map((r) => {
                    const kmRec = r.km_regreso != null ? calcKmRecorridos(r.km_salida, r.km_regreso) : null
                    const fuelData = cargasPorRecorrido.get(r.id)
                    const totalLitros = fuelData?.litros ?? 0
                    const costo = fuelData && fuelData.costo > 0 ? fuelData.costo : null
                    const litrosConsumidos =
                      kmRec != null &&
                      r.combustible_regreso != null &&
                      r.vehiculos?.capacidad_tanque_litros
                        ? calcLitrosConsumidos(
                            r.vehiculos.capacidad_tanque_litros,
                            r.combustible_salida,
                            r.combustible_regreso,
                            totalLitros
                          )
                        : null
                    const rend =
                      kmRec != null && litrosConsumidos != null && litrosConsumidos > 0
                        ? calcRendimiento(kmRec, litrosConsumidos)
                        : null

                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-3 font-medium whitespace-nowrap">
                          <div>{r.vehiculo_codigo}</div>
                          {r.vehiculos?.placa && <div className="text-xs text-gray-400 font-normal">{r.vehiculos.placa}</div>}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                          {r.conductores?.nombre ?? '—'}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                          {formatFecha(r.fecha_salida)}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                          {r.fecha_regreso ? formatFecha(r.fecha_regreso) : '—'}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          {r.km_salida.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          {r.km_regreso?.toLocaleString() ?? '—'}
                        </td>
                        <td className="px-3 py-3 text-right font-medium whitespace-nowrap">
                          {kmRec != null ? kmRec.toLocaleString() : '—'}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          {totalLitros > 0 ? formatDecimal(totalLitros) : '—'}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          {litrosConsumidos != null && litrosConsumidos > 0 ? formatDecimal(litrosConsumidos) : '—'}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          {costo != null ? formatMoneda(costo) : '—'}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          {rend != null ? `${formatDecimal(rend)} km/L` : '—'}
                        </td>
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          {r.usa_paradas && r.recorridos_paradas.length > 0 ? (
                            <button
                              onClick={() => setParadasModal(r)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-semibold transition-colors"
                              title="Ver paradas"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              {r.recorridos_paradas.length}
                            </button>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          {r.foto_salida_path ? (
                            <button
                              onClick={() => setFotoModal({
                                url: getPublicUrl(r.foto_salida_path!),
                                titulo: `Foto salida — ${r.vehiculo_codigo} · ${formatFecha(r.fecha_salida)}`,
                              })}
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors"
                              title="Ver foto de salida"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </button>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          {r.foto_regreso_path ? (
                            <button
                              onClick={() => setFotoModal({
                                url: getPublicUrl(r.foto_regreso_path!),
                                titulo: `Foto regreso — ${r.vehiculo_codigo} · ${r.fecha_regreso ? formatFecha(r.fecha_regreso) : ''}`,
                              })}
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-green-50 hover:bg-green-100 text-green-600 transition-colors"
                              title="Ver foto de regreso"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </button>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              r.estado === 'cerrado'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-orange-100 text-orange-700'
                            }`}
                          >
                            {r.estado === 'cerrado' ? 'Cerrado' : 'En ruta'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {registrosDisplay.length > 0 && (
            <>
              <Paginacion pagina={paginaRec} total={totalPaginasRec} onChange={setPaginaRec} />
              <p className="text-xs text-gray-400 text-center pb-6">
                Mostrando {((paginaRec - 1) * PAGINA_TAMAÑO) + 1}–{Math.min(paginaRec * PAGINA_TAMAÑO, registrosDisplay.length)} de {registrosDisplay.length} registros. La descarga incluye todos los registros filtrados.
              </p>
            </>
          )}
        </div>
      )}

      {/* ─── Vista: Cargas de gasolina ─────────────────────────────────────── */}
      {vistaActiva === 'cargas' && (
        <div className="px-4 py-4 max-w-5xl mx-auto w-full space-y-4">

          {/* Filtros cargas */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
            {/* Fechas */}
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">Desde</label>
                <input
                  type="date"
                  value={filtroFechaInicio}
                  onChange={(e) => setFiltroFechaInicio(e.target.value)}
                  className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">Hasta</label>
                <input
                  type="date"
                  value={filtroFechaFin}
                  onChange={(e) => setFiltroFechaFin(e.target.value)}
                  className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Vehículo, conductor, tipo */}
            <div className="flex flex-wrap gap-3">
              <select
                value={filtroVehiculoCargas}
                onChange={(e) => setFiltroVehiculoCargas(e.target.value)}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todos los vehículos</option>
                {vehiculosCargas.map((v) => (
                  <option key={v.codigo} value={v.codigo}>
                    {v.codigo}{v.placa ? ` — ${v.placa}` : ''}
                  </option>
                ))}
              </select>

              <select
                value={filtroConductorCargas}
                onChange={(e) => { setFiltroConductorCargas(e.target.value); setPaginaCargas(1) }}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todos los conductores</option>
                {conductoresCargas.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <select
                value={filtroTipoCarga}
                onChange={(e) => { setFiltroTipoCarga(e.target.value as TipoCarga); setPaginaCargas(1) }}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="todas">Todos los tipos</option>
                <option value="en_recorrido">En recorrido</option>
                <option value="fuera_recorrido">Fuera de recorrido</option>
              </select>
            </div>
          </div>

          {/* Exportar cargas */}
          <ExportButtons
            onCsv={() => exportarCargas('csv')}
            onXlsx={() => exportarCargas('xlsx')}
            onPdf={() => exportarCargas('pdf')}
            deshabilitado={cargandoCargas || cargasFiltradas.length === 0}
          />

          {errorCargas && <ErrorMessage mensaje={errorCargas} />}

          {cargandoCargas ? (
            <Loading texto="Cargando cargas de gasolina..." />
          ) : (
            <>
              {/* Tarjetas de resumen */}
              {cargasFiltradas.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-3 text-center">
                    <p className="text-xs text-gray-500">Total cargas</p>
                    <p className="text-lg font-bold text-gray-800">{cargasFiltradas.length}</p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-3 text-center">
                    <p className="text-xs text-gray-500">Total litros</p>
                    <p className="text-lg font-bold text-gray-800">{formatDecimal(totalLitrosCargas, 3)} L</p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-3 text-center">
                    <p className="text-xs text-gray-500">Precio prom./L</p>
                    <p className="text-lg font-bold text-gray-800">
                      {promedioPrecioLitro > 0 ? `$${promedioPrecioLitro.toFixed(3)}` : '—'}
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-3 text-center">
                    <p className="text-xs text-gray-500">Total gastado</p>
                    <p className="text-lg font-bold text-blue-600">{formatMoneda(totalPesosCargas)}</p>
                  </div>
                </div>
              )}

              {cargasFiltradas.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <span className="text-4xl">⛽</span>
                  <p className="mt-2 text-sm">No hay cargas de gasolina para este período</p>
                </div>
              ) : (
                /* Tabla cargas — scroll horizontal en mobile */
                <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm">
                  <table className="min-w-full bg-white text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                        <th className="px-3 py-3 text-left">Conductor</th>
                        <th className="px-3 py-3 text-center">Vehículo</th>
                        <th className="px-3 py-3 text-center">Modelo</th>
                        <th className="px-3 py-3 text-center">Fecha carga</th>
                        <th className="px-3 py-3 text-center">KM antes</th>
                        <th className="px-3 py-3 text-center">KM después</th>
                        <th className="px-3 py-3 text-center">Nivel antes</th>
                        <th className="px-3 py-3 text-center">Nivel después</th>
                        <th className="px-3 py-3 text-center">Litros</th>
                        <th className="px-3 py-3 text-center">$/L</th>
                        <th className="px-3 py-3 text-center">Total</th>
                        <th className="px-3 py-3 text-center">Tipo</th>
                        <th className="px-3 py-3 text-center">Destino</th>
                        <th className="px-3 py-3 text-center">Obs</th>
                        <th className="px-3 py-3 text-center">Fotos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {cargasPaginadas.map((c) => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="px-3 py-3 whitespace-nowrap text-gray-700">{c.conductor}</td>
                          <td className="px-3 py-3 whitespace-nowrap font-medium">
                            <div>{c.vehiculo_codigo}</div>
                            {c.placa && <div className="text-xs text-gray-400 font-normal">{c.placa}</div>}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-gray-600 text-sm">
                            {c.modelo ?? '—'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-gray-600 text-sm">
                            {formatFecha(c.fecha_carga)}
                          </td>
                          <td className="px-3 py-3 text-right whitespace-nowrap text-gray-600">
                            {c.km_antes.toLocaleString()}
                          </td>
                          <td className="px-3 py-3 text-right whitespace-nowrap text-gray-600">
                            {c.km_despues.toLocaleString()}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600">
                            {combustibleLabel(c.combustible_antes)}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600">
                            {combustibleLabel(c.combustible_despues)}
                          </td>
                          <td className="px-3 py-3 text-right whitespace-nowrap font-medium">
                            {c.litros_cargados.toFixed(3)} L
                          </td>
                          <td className="px-3 py-3 text-right whitespace-nowrap text-gray-600">
                            ${c.precio_litro.toFixed(3)}
                          </td>
                          <td className="px-3 py-3 text-right whitespace-nowrap font-semibold text-blue-700">
                            {formatMoneda(c.costo_total)}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              c.recorrido_id
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {c.recorrido_id ? 'En recorrido' : 'Fuera de recorrido'}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">
                            {c.destino ?? <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            {c.observaciones ? (
                              <span title={c.observaciones} className="inline-block w-2 h-2 rounded-full bg-yellow-400" />
                            ) : (
                              <span className="text-gray-300 text-sm">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            <div className="flex gap-1 justify-center">
                              {c.foto_tablero_antes_path ? (
                                <button
                                  onClick={() => setFotoModal({ url: getPublicUrlCarga(c.foto_tablero_antes_path!), titulo: `Tablero antes — ${c.vehiculo_codigo}` })}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-bold transition-colors"
                                  title="Tablero antes"
                                >A</button>
                              ) : (
                                <span className="w-7 h-7 flex items-center justify-center text-gray-300 text-xs">A</span>
                              )}
                              {c.foto_tablero_despues_path ? (
                                <button
                                  onClick={() => setFotoModal({ url: getPublicUrlCarga(c.foto_tablero_despues_path!), titulo: `Tablero después — ${c.vehiculo_codigo}` })}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-green-50 hover:bg-green-100 text-green-600 text-xs font-bold transition-colors"
                                  title="Tablero después"
                                >D</button>
                              ) : (
                                <span className="w-7 h-7 flex items-center justify-center text-gray-300 text-xs">D</span>
                              )}
                              {c.foto_ticket_path ? (
                                <button
                                  onClick={() => setFotoModal({ url: getPublicUrlCarga(c.foto_ticket_path!), titulo: `Ticket — ${c.vehiculo_codigo}` })}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-600 text-xs font-bold transition-colors"
                                  title="Ticket de gasolina"
                                >T</button>
                              ) : (
                                <span className="w-7 h-7 flex items-center justify-center text-gray-300 text-xs">T</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {cargasFiltradas.length > 0 && (
                <>
                  <Paginacion pagina={paginaCargas} total={totalPaginasCargas} onChange={setPaginaCargas} />
                  <p className="text-xs text-gray-400 text-center pb-6">
                    Mostrando {((paginaCargas - 1) * PAGINA_TAMAÑO) + 1}–{Math.min(paginaCargas * PAGINA_TAMAÑO, cargasFiltradas.length)} de {cargasFiltradas.length} cargas.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
