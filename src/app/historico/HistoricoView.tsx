'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { calcKmRecorridos, calcImporte, calcLitrosConsumidos, calcRendimiento } from '@/lib/calculations'
import { formatFecha, formatMoneda, formatDecimal } from '@/utils/formatters'
import { combustibleLabel } from '@/lib/constants'
import { getPublicUrl } from '@/utils/storage'
import Loading from '@/components/common/Loading'
import ErrorMessage from '@/components/common/ErrorMessage'
import ExportButtons from '@/components/common/ExportButtons'
import {
  PERIODOS,
  type CargaGasolina,
  type Periodo,
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
  const [filtroPeriodo, setFiltroPeriodo] = useState<Periodo>('todo')
  const [fotoModal, setFotoModal] = useState<{ url: string; titulo: string } | null>(null)
  const [paradasModal, setParadasModal] = useState<RecorridoHistorico | null>(null)

  // ── Estado: Cargas de gasolina ────────────────────────────────────────────
  const hoy = new Date()
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

  // ── Efectos ───────────────────────────────────────────────────────────────
  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroVehiculo, filtroPeriodo])

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

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase.from('recorridos') as any)
        .select(`
          id, vehiculo_codigo, estado, usa_paradas, fecha_salida, fecha_regreso,
          km_salida, km_regreso, combustible_salida, combustible_regreso,
          litros_cargados, precio_litro, foto_salida_path, foto_regreso_path,
          conductores(nombre),
          centros_costo(nombre),
          vehiculos(capacidad_tanque_litros, placa, apodo),
          recorridos_paradas(id, orden, estado, km_parada, combustible_parada, litros_cargados, precio_litro, foto_parada_path, centros_costo(nombre))
        `)
        .order('fecha_salida', { ascending: false })
        .limit(50)

      query = aplicarFiltrosRecorridos(query, filtroVehiculo, filtroPeriodo)

      const { data, error: qError } = await query
      if (qError) throw new Error(qError.message)

      const rows = (data ?? []) as RecorridoHistorico[]
      setRegistros(rows)

      const unicos = [
        ...new Map(rows.map((r) => [r.vehiculo_codigo, { codigo: r.vehiculo_codigo, placa: r.vehiculos?.placa ?? null, apodo: r.vehiculos?.apodo ?? null }])).values(),
      ].sort((a, b) => a.codigo.localeCompare(b.codigo))
      setVehiculos(unicos)
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

    try {
      const fechaInicioISO = new Date(filtroFechaInicio + 'T00:00:00').toISOString()
      const fechaFinISO = new Date(filtroFechaFin + 'T23:59:59').toISOString()

      // Query 1: cargas al cerrar recorrido
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q1 = (supabase.from('recorridos') as any)
        .select(`
          id, vehiculo_codigo, fecha_regreso, km_regreso, litros_cargados, precio_litro,
          conductores(nombre),
          vehiculos(placa, modelo)
        `)
        .not('litros_cargados', 'is', null)
        .gt('litros_cargados', 0)
        .not('precio_litro', 'is', null)
        .gt('precio_litro', 0)
        .not('fecha_regreso', 'is', null)
        .gte('fecha_regreso', fechaInicioISO)
        .lte('fecha_regreso', fechaFinISO)

      // Query 2: cargas en paradas intermedias
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q2 = (supabase.from('recorridos_paradas') as any)
        .select(`
          id, recorrido_id, fecha_parada, km_parada, litros_cargados, precio_litro,
          recorridos!inner(vehiculo_codigo, conductores(nombre), vehiculos(placa, modelo))
        `)
        .not('litros_cargados', 'is', null)
        .gt('litros_cargados', 0)
        .not('precio_litro', 'is', null)
        .gt('precio_litro', 0)
        .not('fecha_parada', 'is', null)
        .gte('fecha_parada', fechaInicioISO)
        .lte('fecha_parada', fechaFinISO)

      const [{ data: d1, error: e1 }, { data: d2, error: e2 }] = await Promise.all([q1, q2])

      if (e1) throw new Error(e1.message)
      if (e2) throw new Error(e2.message)

      // Normalizar a estructura común
      type RawCarga = Omit<CargaGasolina, 'fecha_siguiente_carga' | 'km_siguiente_carga'>
      const lista: RawCarga[] = []

      for (const r of (d1 ?? [])) {
        if (!r.km_regreso) continue
        lista.push({
          recorrido_id: r.id,
          parada_id: null,
          tipo_carga: 'regreso_final',
          vehiculo_codigo: r.vehiculo_codigo,
          placa: r.vehiculos?.placa ?? null,
          modelo: r.vehiculos?.modelo ?? null,
          conductor: r.conductores?.nombre ?? '—',
          fecha_carga: r.fecha_regreso,
          km_carga: r.km_regreso,
          litros_cargados: Number(r.litros_cargados),
          precio_litro: Number(r.precio_litro),
          costo_total: Number(r.litros_cargados) * Number(r.precio_litro),
        })
      }

      for (const p of (d2 ?? [])) {
        if (!p.km_parada || !p.fecha_parada) continue
        const rec = p.recorridos
        lista.push({
          recorrido_id: p.recorrido_id,
          parada_id: p.id,
          tipo_carga: 'parada_intermedia',
          vehiculo_codigo: rec?.vehiculo_codigo ?? '',
          placa: rec?.vehiculos?.placa ?? null,
          modelo: rec?.vehiculos?.modelo ?? null,
          conductor: rec?.conductores?.nombre ?? '—',
          fecha_carga: p.fecha_parada,
          km_carga: p.km_parada,
          litros_cargados: Number(p.litros_cargados),
          precio_litro: Number(p.precio_litro),
          costo_total: Number(p.litros_cargados) * Number(p.precio_litro),
        })
      }

      // Filtrar por vehículo si aplica
      const listaFiltrada = filtroVehiculoCargas
        ? lista.filter((c) => c.vehiculo_codigo === filtroVehiculoCargas)
        : lista

      // Ordenar por vehículo → fecha → km (para calcular siguiente carga)
      listaFiltrada.sort((a, b) => {
        if (a.vehiculo_codigo !== b.vehiculo_codigo) {
          return a.vehiculo_codigo.localeCompare(b.vehiculo_codigo)
        }
        const da = new Date(a.fecha_carga).getTime()
        const db = new Date(b.fecha_carga).getTime()
        if (da !== db) return da - db
        return a.km_carga - b.km_carga
      })

      // Lógica LEAD: siguiente carga del mismo vehículo
      const conSiguiente: CargaGasolina[] = listaFiltrada.map((item, idx) => {
        const next = listaFiltrada[idx + 1]
        const tieneSiguiente = next && next.vehiculo_codigo === item.vehiculo_codigo
        return {
          ...item,
          fecha_siguiente_carga: tieneSiguiente ? next.fecha_carga : null,
          km_siguiente_carga: tieneSiguiente ? next.km_carga : null,
        }
      })

      // Reordenar para mostrar: más reciente primero
      conSiguiente.sort((a, b) => {
        const da = new Date(a.fecha_carga).getTime()
        const db = new Date(b.fecha_carga).getTime()
        if (da !== db) return db - da
        return b.km_carga - a.km_carga
      })

      setCargas(conSiguiente)
    } catch (err) {
      setErrorCargas(err instanceof Error ? err.message : 'Error al cargar cargas de gasolina')
    } finally {
      setCargandoCargas(false)
    }
  }

  // ── Totales recorridos ────────────────────────────────────────────────────
  const cerrados = registros.filter((r) => r.estado === 'cerrado')
  const totalKm = cerrados.reduce(
    (acc, r) => acc + (r.km_regreso != null ? calcKmRecorridos(r.km_salida, r.km_regreso) : 0),
    0
  )
  const totalCosto = cerrados.reduce(
    (acc, r) =>
      acc + (r.litros_cargados && r.precio_litro ? calcImporte(r.litros_cargados, r.precio_litro) : 0),
    0
  )

  // ── Totales y filtros cargas ──────────────────────────────────────────────
  const cargasFiltradas = cargas.filter((c) => {
    if (filtroConductorCargas && c.conductor !== filtroConductorCargas) return false
    if (filtroTipoCarga !== 'todas' && c.tipo_carga !== filtroTipoCarga) return false
    return true
  })

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
  async function obtenerRecorridosParaExportar(): Promise<RecorridoHistorico[] | null> {
    if (filtroPeriodo === 'todo') {
      const total = await contarRecorridos(filtroVehiculo, filtroPeriodo)
      if (total > 200) {
        const continuar = window.confirm(
          `El período "Todo" incluye ${total.toLocaleString()} recorridos. ` +
          `¿Descargar todos? Para un archivo más pequeño, elige un período más corto antes de exportar.`
        )
        if (!continuar) return null
      }
    }
    const datos = await fetchRecorridosCompletos(filtroVehiculo, filtroPeriodo)
    if (datos.length === 0) throw new Error('No hay registros para exportar con los filtros actuales')
    return datos
  }

  async function exportarRecorridos(formato: 'csv' | 'xlsx' | 'pdf') {
    const datos = await obtenerRecorridosParaExportar()
    if (!datos) return
    if (formato === 'csv') exportarRecorridosCsv(datos)
    else if (formato === 'xlsx') exportarRecorridosXlsx(datos)
    else exportarRecorridosPdf(datos, filtroVehiculo, filtroPeriodo)
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
            : filtroTipoCarga === 'regreso_final'
              ? 'Regreso final'
              : 'Parada intermedia',
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
                          {p.litros_cargados != null && p.litros_cargados > 0 && (
                            <div>
                              <span className="text-gray-400">Litros cargados</span>
                              <span className="ml-1 font-medium text-gray-700">{formatDecimal(p.litros_cargados)} L</span>
                            </div>
                          )}
                          {p.litros_cargados && p.precio_litro ? (
                            <div>
                              <span className="text-gray-400">Costo recarga</span>
                              <span className="ml-1 font-medium text-gray-700">{formatMoneda(calcImporte(p.litros_cargados, p.precio_litro))}</span>
                            </div>
                          ) : null}
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
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>
                      <span className="font-semibold text-gray-700">
                        {paradasModal.recorridos_paradas.filter(p => p.estado === 'completada').length}
                      </span>
                      /{paradasModal.recorridos_paradas.length} completadas
                    </span>
                    {(() => {
                      const totalLitros = paradasModal.recorridos_paradas.reduce(
                        (acc, p) => acc + (p.litros_cargados ?? 0), 0
                      )
                      const totalCostoParadas = paradasModal.recorridos_paradas.reduce(
                        (acc, p) => acc + (p.litros_cargados && p.precio_litro ? calcImporte(p.litros_cargados, p.precio_litro) : 0), 0
                      )
                      return totalLitros > 0 ? (
                        <>
                          <span>Total recargado: <span className="font-semibold text-gray-700">{formatDecimal(totalLitros)} L</span></span>
                          {totalCostoParadas > 0 && (
                            <span>Costo: <span className="font-semibold text-gray-700">{formatMoneda(totalCostoParadas)}</span></span>
                          )}
                        </>
                      ) : null
                    })()}
                  </div>
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

            <div className="flex gap-1 flex-wrap">
              {PERIODOS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setFiltroPeriodo(p.value as Periodo)}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    filtroPeriodo === p.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Exportar recorridos */}
          <ExportButtons
            onCsv={() => exportarRecorridos('csv')}
            onXlsx={() => exportarRecorridos('xlsx')}
            onPdf={() => exportarRecorridos('pdf')}
            deshabilitado={cargando || registros.length === 0}
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
          ) : registros.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <span className="text-4xl">📋</span>
              <p className="mt-2 text-sm">No hay registros para este filtro</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm">
              <table className="min-w-full bg-white text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                    <th className="px-3 py-3 text-left whitespace-nowrap">Vehículo</th>
                    <th className="px-3 py-3 text-left whitespace-nowrap">Conductor</th>
                    <th className="px-3 py-3 text-left whitespace-nowrap">Salida</th>
                    <th className="px-3 py-3 text-left whitespace-nowrap">Regreso</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap">KM sal.</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap">KM reg.</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap">KM rec.</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap">L. recargados</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap">L. consumidos</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap">Costo</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap">Rend.</th>
                    <th className="px-3 py-3 text-center whitespace-nowrap">Paradas</th>
                    <th className="px-3 py-3 text-center whitespace-nowrap">Foto sal.</th>
                    <th className="px-3 py-3 text-center whitespace-nowrap">Foto reg.</th>
                    <th className="px-3 py-3 text-center whitespace-nowrap">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {registros.map((r) => {
                    const kmRec = r.km_regreso != null ? calcKmRecorridos(r.km_salida, r.km_regreso) : null
                    const costo =
                      r.litros_cargados && r.precio_litro
                        ? calcImporte(r.litros_cargados, r.precio_litro)
                        : null
                    const litrosConsumidos =
                      kmRec != null &&
                      r.combustible_regreso != null &&
                      r.vehiculos?.capacidad_tanque_litros
                        ? calcLitrosConsumidos(
                            r.vehiculos.capacidad_tanque_litros,
                            r.combustible_salida,
                            r.combustible_regreso,
                            r.litros_cargados ?? 0
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
                          {r.litros_cargados ? formatDecimal(r.litros_cargados) : '—'}
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

          <p className="text-xs text-gray-400 text-center pb-6">
            Mostrando máximo 50 registros. La descarga incluye todos los registros filtrados.
          </p>
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
                onChange={(e) => setFiltroConductorCargas(e.target.value)}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todos los conductores</option>
                {conductoresCargas.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <select
                value={filtroTipoCarga}
                onChange={(e) => setFiltroTipoCarga(e.target.value as TipoCarga)}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="todas">Todos los tipos</option>
                <option value="regreso_final">Regreso final</option>
                <option value="parada_intermedia">Parada intermedia</option>
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
                        <th className="px-3 py-3 text-left whitespace-nowrap">Conductor</th>
                        <th className="px-3 py-3 text-left whitespace-nowrap">Placa</th>
                        <th className="px-3 py-3 text-left whitespace-nowrap">Modelo</th>
                        <th className="px-3 py-3 text-left whitespace-nowrap">Tipo</th>
                        <th className="px-3 py-3 text-left whitespace-nowrap">Fecha carga</th>
                        <th className="px-3 py-3 text-right whitespace-nowrap">KM carga</th>
                        <th className="px-3 py-3 text-right whitespace-nowrap">Litros</th>
                        <th className="px-3 py-3 text-right whitespace-nowrap">$/L</th>
                        <th className="px-3 py-3 text-right whitespace-nowrap">Costo total</th>
                        <th className="px-3 py-3 text-left whitespace-nowrap">Sig. carga</th>
                        <th className="px-3 py-3 text-right whitespace-nowrap">KM sig. carga</th>
                        <th className="px-3 py-3 text-right whitespace-nowrap">Tiempo entre cargas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {cargasFiltradas.map((c, idx) => (
                        <tr key={`${c.recorrido_id}-${c.parada_id ?? 'regreso'}-${idx}`} className="hover:bg-gray-50">
                          <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-800">
                            {c.conductor}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                            {c.placa ?? '—'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                            {c.modelo ?? '—'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              c.tipo_carga === 'regreso_final'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-purple-100 text-purple-700'
                            }`}>
                              {c.tipo_carga === 'regreso_final' ? 'Regreso final' : 'Parada intermedia'}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                            {formatFecha(c.fecha_carga)}
                          </td>
                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            {c.km_carga.toLocaleString()}
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
                          <td className="px-3 py-3 whitespace-nowrap text-gray-500 text-xs">
                            {c.fecha_siguiente_carga
                              ? formatFecha(c.fecha_siguiente_carga)
                              : <span className="text-gray-300 italic">Sin siguiente carga</span>
                            }
                          </td>
                          <td className="px-3 py-3 text-right whitespace-nowrap text-gray-500">
                            {c.km_siguiente_carga != null
                              ? c.km_siguiente_carga.toLocaleString()
                              : <span className="text-gray-300">—</span>
                            }
                          </td>
                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            {c.fecha_siguiente_carga
                              ? <span className="font-medium text-gray-700">{formatTiempoEntre(c.fecha_carga, c.fecha_siguiente_carga)}</span>
                              : <span className="text-gray-300">—</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
