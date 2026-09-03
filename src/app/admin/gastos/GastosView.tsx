'use client'

// Gastos consolidados de la flotilla: combustible (cargas_gasolina) +
// mantenimientos (costo de taller) + refacciones y otros gastos.
// Mismo patrón de filtros/gráficas que /indicadores, pero el desglose
// es por categoría de gasto en lugar de por km.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Chart } from 'react-chartjs-2'
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  subWeeks,
  subMonths,
  addDays,
  getDate,
  format,
  parseISO,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { supabase, type Mantenimiento, type Refaccion } from '@/lib/supabase'
import { formatMoneda } from '@/utils/formatters'
import Loading from '@/components/common/Loading'
import ErrorMessage from '@/components/common/ErrorMessage'
import ExportButtons from '@/components/common/ExportButtons'
import { AvisoMigracion } from '../mantenimientos/shared'
import {
  buildDatasetsStackedConTendencia,
  stackedTotalPlugin,
  chartOptionsConLeyenda,
  chartOptionsStacked,
  type TipoFiltro,
  type TipoGrafica,
} from '@/app/indicadores/chartConfig'
import {
  exportarGastosCsv,
  exportarGastosXlsx,
  exportarGastosPdf,
  type DatosGastos,
  type ResumenVehiculoGasto,
  type SerieApilada,
} from './exportGastos'
import { CATEGORIA_LABELS, type CategoriaLabel } from './categorias'

interface CargaGastoRow {
  vehiculo_codigo: string
  litros_cargados: number
  precio_litro: number
  created_at: string
}

interface VehiculoLabel {
  codigo: string
  apodo: string | null
  placa: string | null
}

type MapaCategoria = Record<string, Record<string, number>>

function hoy() {
  return format(new Date(), 'yyyy-MM-dd')
}
function inicioSemanaActual() {
  return format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
}
function mesAnioActual() {
  return format(new Date(), 'yyyy-MM')
}

function sumarEnMapa(mapa: MapaCategoria, clave: string, categoria: CategoriaLabel, monto: number) {
  if (!monto) return
  if (!mapa[clave]) {
    mapa[clave] = { Combustible: 0, Mantenimiento: 0, Refacciones: 0, 'Otros gastos': 0 }
  }
  mapa[clave][categoria] += monto
}

function totalDeFila(fila: Record<string, number> | undefined): number {
  if (!fila) return 0
  return CATEGORIA_LABELS.reduce((s, cat) => s + (fila[cat] ?? 0), 0)
}

export default function GastosView() {
  const router = useRouter()
  const [vehiculos, setVehiculos] = useState<VehiculoLabel[]>([])
  const [cargas, setCargas] = useState<CargaGastoRow[]>([])
  const [mantenimientos, setMantenimientos] = useState<Mantenimiento[]>([])
  const [refacciones, setRefacciones] = useState<Refaccion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requiereMigracionMant, setRequiereMigracionMant] = useState(false)
  const [requiereMigracionRef, setRequiereMigracionRef] = useState(false)

  // Filtro de período (idéntico a /indicadores)
  const [tipo, setTipo] = useState<TipoFiltro>('mes')
  const [fechaDia, setFechaDia] = useState(hoy())
  const [semanaRef, setSemanaRef] = useState(inicioSemanaActual())
  const [mesAnio, setMesAnio] = useState(mesAnioActual())
  const [rangoDesde, setRangoDesde] = useState(() => format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [rangoHasta, setRangoHasta] = useState(hoy())

  // Filtro por vehículo
  const [vehiculoFiltro, setVehiculoFiltro] = useState('')

  // Tipo de gráfica
  const [tipoGrafica, setTipoGrafica] = useState<TipoGrafica>('barras')

  useEffect(() => { cargarVehiculos() }, [])

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, fechaDia, semanaRef, mesAnio, rangoDesde, rangoHasta])

  async function cargarVehiculos() {
    const { data } = await supabase
      .from('vehiculos')
      .select('codigo, apodo, placa')
      .order('codigo', { ascending: true })
    if (data) setVehiculos(data as VehiculoLabel[])
  }

  function calcularRango(): { desde: string; hasta: string } {
    switch (tipo) {
      case 'dia': {
        const d = parseISO(fechaDia)
        return { desde: startOfDay(subDays(d, 1)).toISOString(), hasta: endOfDay(addDays(d, 1)).toISOString() }
      }
      case 'semana': {
        const lunes = parseISO(semanaRef)
        return {
          desde: startOfDay(lunes).toISOString(),
          hasta: endOfDay(endOfWeek(lunes, { weekStartsOn: 1 })).toISOString(),
        }
      }
      case 'mes': {
        const d = parseISO(`${mesAnio}-01`)
        return { desde: startOfMonth(d).toISOString(), hasta: endOfMonth(d).toISOString() }
      }
      case 'rango':
        return {
          desde: startOfDay(parseISO(rangoDesde)).toISOString(),
          hasta: endOfDay(parseISO(rangoHasta)).toISOString(),
        }
    }
  }

  async function cargar() {
    setCargando(true)
    setError(null)
    try {
      const { desde, hasta } = calcularRango()

      const { data: cargasData, error: errCargas } = await supabase
        .from('cargas_gasolina')
        .select('vehiculo_codigo, litros_cargados, precio_litro, created_at')
        .gte('created_at', desde)
        .lte('created_at', hasta)
        .order('created_at', { ascending: true })
      if (errCargas) throw new Error(errCargas.message)
      setCargas((cargasData ?? []) as CargaGastoRow[])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: mantsData, error: errMants } = await (supabase.from('mantenimientos') as any)
        .select('*')
        .gte('fecha_ingreso', desde)
        .lte('fecha_ingreso', hasta)
      if (errMants) {
        setRequiereMigracionMant(true)
        setMantenimientos([])
      } else {
        setRequiereMigracionMant(false)
        setMantenimientos(((mantsData as Mantenimiento[]) ?? []).filter((m) => !m.eliminado))
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: refsData, error: errRefs } = await (supabase.from('refacciones') as any)
        .select('*')
        .gte('fecha_compra', desde)
        .lte('fecha_compra', hasta)
      if (errRefs) {
        setRequiereMigracionRef(true)
        setRefacciones([])
      } else {
        setRequiereMigracionRef(false)
        setRefacciones(((refsData as Refaccion[]) ?? []).filter((r) => !r.eliminado))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar gastos')
    } finally {
      setCargando(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading texto="Calculando gastos..." />
      </div>
    )
  }

  // ── Datos filtrados por vehículo ────────────────────────────────────────────
  const cargasF = vehiculoFiltro ? cargas.filter((c) => c.vehiculo_codigo === vehiculoFiltro) : cargas
  const mantsF = vehiculoFiltro ? mantenimientos.filter((m) => m.vehiculo_codigo === vehiculoFiltro) : mantenimientos
  const refsF = vehiculoFiltro ? refacciones.filter((r) => r.vehiculo_codigo === vehiculoFiltro) : refacciones
  const soloRefacciones = refsF.filter((r) => (r.categoria ?? 'refaccion') === 'refaccion')
  const soloOtros = refsF.filter((r) => r.categoria === 'gasto')

  const hayDatos = cargasF.length > 0 || mantsF.length > 0 || refsF.length > 0

  // Mapas codigo → apodo / placa
  const apodoMap = Object.fromEntries(vehiculos.map((v) => [v.codigo, v.apodo]))
  const placaMap = Object.fromEntries(vehiculos.map((v) => [v.codigo, v.placa]))
  const labelVehiculo = (codigo: string) => {
    const placa = placaMap[codigo] ?? null
    const apodo = apodoMap[codigo] ?? null
    return [placa, apodo].filter(Boolean).join(' — ') || codigo
  }

  // ── Totales globales ────────────────────────────────────────────────────────
  const totalCombustible = cargasF.reduce((s, c) => s + c.litros_cargados * c.precio_litro, 0)
  const totalMantenimiento = mantsF.reduce((s, m) => s + (m.costo ?? 0), 0)
  const totalRefacciones = soloRefacciones.reduce((s, r) => s + r.costo, 0)
  const totalOtros = soloOtros.reduce((s, r) => s + r.costo, 0)
  const totalGasto = totalCombustible + totalMantenimiento + totalRefacciones + totalOtros

  // ── Agrupación temporal (idéntica a /indicadores) ──────────────────────────
  const esPorDia = tipo === 'dia' || tipo === 'semana'
  const unidadTemporal = tipo === 'mes' ? 'semana' : esPorDia ? 'día' : 'mes'
  const labelPeriodo = tipo === 'mes' ? 'Gasto por semana' : esPorDia ? 'Gasto por día' : 'Gasto por mes'

  const keyPeriodo = (fecha: string) => {
    if (tipo === 'dia' || tipo === 'semana') {
      return format(new Date(fecha), 'dd MMM', { locale: es })
    }
    if (tipo === 'mes') {
      const day = getDate(new Date(fecha))
      if (day <= 7) return 'Sem 1'
      if (day <= 14) return 'Sem 2'
      if (day <= 21) return 'Sem 3'
      return 'Sem 4'
    }
    return format(new Date(fecha), 'MMM yyyy', { locale: es })
  }

  const periodLabels: string[] | null = (() => {
    if (tipo === 'dia') {
      const d = parseISO(fechaDia)
      return [
        format(subDays(d, 1), 'dd MMM', { locale: es }),
        format(d, 'dd MMM', { locale: es }),
        format(addDays(d, 1), 'dd MMM', { locale: es }),
      ]
    }
    if (tipo === 'semana') {
      const lunes = parseISO(semanaRef)
      return Array.from({ length: 7 }, (_, i) => format(addDays(lunes, i), 'dd MMM', { locale: es }))
    }
    if (tipo === 'mes') {
      return ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4']
    }
    return null
  })()

  const allPeriodKeys: string[] = periodLabels ?? (() => {
    const fechas = [
      ...cargasF.map((c) => c.created_at),
      ...mantsF.map((m) => m.fecha_ingreso),
      ...refsF.map((r) => r.fecha_compra),
    ].sort()
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const f of fechas) {
      const k = keyPeriodo(f)
      if (!seen.has(k)) { seen.add(k); ordered.push(k) }
    }
    return ordered
  })()

  // ── Desglose por vehículo × categoría ──────────────────────────────────────
  const gastoPorVehiculo: MapaCategoria = {}
  for (const c of cargasF) sumarEnMapa(gastoPorVehiculo, c.vehiculo_codigo, 'Combustible', c.litros_cargados * c.precio_litro)
  for (const m of mantsF) sumarEnMapa(gastoPorVehiculo, m.vehiculo_codigo, 'Mantenimiento', m.costo ?? 0)
  for (const r of soloRefacciones) sumarEnMapa(gastoPorVehiculo, r.vehiculo_codigo, 'Refacciones', r.costo)
  for (const r of soloOtros) sumarEnMapa(gastoPorVehiculo, r.vehiculo_codigo, 'Otros gastos', r.costo)

  const vehiculosOrdenados = Object.keys(gastoPorVehiculo).sort(
    (a, b) => totalDeFila(gastoPorVehiculo[b]) - totalDeFila(gastoPorVehiculo[a])
  )

  // ── Desglose por período × categoría ───────────────────────────────────────
  const gastoPorPeriodo: MapaCategoria = {}
  for (const c of cargasF) sumarEnMapa(gastoPorPeriodo, keyPeriodo(c.created_at), 'Combustible', c.litros_cargados * c.precio_litro)
  for (const m of mantsF) sumarEnMapa(gastoPorPeriodo, keyPeriodo(m.fecha_ingreso), 'Mantenimiento', m.costo ?? 0)
  for (const r of soloRefacciones) sumarEnMapa(gastoPorPeriodo, keyPeriodo(r.fecha_compra), 'Refacciones', r.costo)
  for (const r of soloOtros) sumarEnMapa(gastoPorPeriodo, keyPeriodo(r.fecha_compra), 'Otros gastos', r.costo)

  // ── Resumen por vehículo (tabla + exportación) ─────────────────────────────
  const resumenVehiculos: ResumenVehiculoGasto[] = vehiculosOrdenados.map((codigo) => {
    const fila = gastoPorVehiculo[codigo]
    return {
      codigo,
      placa: placaMap[codigo] ?? null,
      apodo: apodoMap[codigo] ?? null,
      combustible: fila.Combustible,
      mantenimiento: fila.Mantenimiento,
      refacciones: fila.Refacciones,
      otros: fila['Otros gastos'],
      total: totalDeFila(fila),
    }
  })

  function toSerieApilada(claves: string[], mapa: MapaCategoria): SerieApilada {
    return {
      labels: claves,
      porCategoria: CATEGORIA_LABELS.map((cat) => claves.map((k) => mapa[k]?.[cat] ?? 0)),
    }
  }

  // ── Exportación ────────────────────────────────────────────────────────────
  function descripcionPeriodo(): string {
    switch (tipo) {
      case 'dia':
        return format(parseISO(fechaDia), "d 'de' MMMM 'de' yyyy", { locale: es })
      case 'semana':
        return `Semana del ${format(parseISO(semanaRef), 'd MMM', { locale: es })} al ${format(
          endOfWeek(parseISO(semanaRef), { weekStartsOn: 1 }), 'd MMM yyyy', { locale: es }
        )}`
      case 'mes':
        return format(parseISO(`${mesAnio}-01`), 'MMMM yyyy', { locale: es })
      case 'rango':
        return `Del ${rangoDesde} al ${rangoHasta}`
    }
  }

  function datosParaExportar(): DatosGastos {
    return {
      filtros: [
        { etiqueta: 'Período', valor: descripcionPeriodo() },
        { etiqueta: 'Vehículo', valor: vehiculoFiltro ? labelVehiculo(vehiculoFiltro) : 'Todos' },
      ],
      unidadPeriodo: `por ${unidadTemporal}`,
      tipoGrafica,
      vehiculoFiltrado: Boolean(vehiculoFiltro),
      totales: {
        combustible: totalCombustible,
        mantenimiento: totalMantenimiento,
        refacciones: totalRefacciones,
        otros: totalOtros,
        total: totalGasto,
      },
      porVehiculo: toSerieApilada(vehiculosOrdenados.map(labelVehiculo), gastoPorVehiculo),
      porPeriodo: toSerieApilada(allPeriodKeys, gastoPorPeriodo),
      resumenVehiculos,
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-emerald-700 text-white px-4 py-5 shadow flex items-center gap-3">
        <button
          onClick={() => router.push('/admin')}
          className="text-emerald-200 hover:text-white transition-colors"
          aria-label="Volver a administración"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold">Gastos</h1>
          <p className="text-emerald-200 text-sm mt-0.5">Combustible, mantenimientos, refacciones y otros gastos</p>
        </div>
      </header>

      <div className="px-4 py-4 w-full max-w-6xl mx-auto space-y-6">
        {requiereMigracionMant && <AvisoMigracion script="mejoras_fase4_mantenimientos.sql" />}
        {!requiereMigracionMant && requiereMigracionRef && (
          <AvisoMigracion script="mejoras_fase5_refacciones.sql" />
        )}

        {/* Selector de período */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <div className="grid grid-cols-4 gap-1 bg-gray-100 rounded-xl p-1">
            {(['dia', 'semana', 'mes', 'rango'] as TipoFiltro[]).map((t) => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tipo === t ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500'
                }`}
              >
                {t === 'dia' ? 'Día' : t === 'semana' ? 'Semana' : t === 'mes' ? 'Mes' : 'Rango'}
              </button>
            ))}
          </div>

          {tipo === 'dia' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setFechaDia(hoy())}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    fechaDia === hoy() ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >Hoy</button>
                <button
                  onClick={() => setFechaDia(format(subDays(new Date(), 1), 'yyyy-MM-dd'))}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    fechaDia === format(subDays(new Date(), 1), 'yyyy-MM-dd') ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >Ayer</button>
              </div>
              <input type="date" value={fechaDia} max={hoy()}
                onChange={(e) => e.target.value && setFechaDia(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          )}

          {tipo === 'semana' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setSemanaRef(inicioSemanaActual())}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    semanaRef === inicioSemanaActual() ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >Esta semana</button>
                <button
                  onClick={() => setSemanaRef(format(startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }), 'yyyy-MM-dd'))}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    semanaRef === format(startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }), 'yyyy-MM-dd') ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >Semana pasada</button>
              </div>
              <p className="text-xs text-gray-500 text-center">Elige cualquier día de la semana:</p>
              <input type="date" value={semanaRef} max={hoy()}
                onChange={(e) => {
                  if (e.target.value)
                    setSemanaRef(format(startOfWeek(parseISO(e.target.value), { weekStartsOn: 1 }), 'yyyy-MM-dd'))
                }}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <p className="text-xs text-gray-400 text-center">
                {format(parseISO(semanaRef), "d 'de' MMM", { locale: es })}
                {' – '}
                {format(endOfWeek(parseISO(semanaRef), { weekStartsOn: 1 }), "d 'de' MMM yyyy", { locale: es })}
              </p>
            </div>
          )}

          {tipo === 'mes' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setMesAnio(mesAnioActual())}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    mesAnio === mesAnioActual() ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >Este mes</button>
                <button
                  onClick={() => setMesAnio(format(subMonths(new Date(), 1), 'yyyy-MM'))}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    mesAnio === format(subMonths(new Date(), 1), 'yyyy-MM') ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >Mes anterior</button>
              </div>
              <input type="month" value={mesAnio} max={mesAnioActual()}
                onChange={(e) => e.target.value && setMesAnio(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          )}

          {tipo === 'rango' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => { setRangoDesde(format(subDays(new Date(), 6), 'yyyy-MM-dd')); setRangoHasta(hoy()) }}
                  className="flex-1 py-2 rounded-xl text-xs font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
                >Últimos 7 días</button>
                <button
                  onClick={() => { setRangoDesde(format(subDays(new Date(), 29), 'yyyy-MM-dd')); setRangoHasta(hoy()) }}
                  className="flex-1 py-2 rounded-xl text-xs font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
                >Últimos 30 días</button>
              </div>
              <div className="flex gap-2 items-center">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Desde</label>
                  <input type="date" value={rangoDesde} max={rangoHasta}
                    onChange={(e) => e.target.value && setRangoDesde(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <span className="text-gray-400 mt-5">→</span>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Hasta</label>
                  <input type="date" value={rangoHasta} min={rangoDesde} max={hoy()}
                    onChange={(e) => e.target.value && setRangoHasta(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Filtro por vehículo */}
        {vehiculos.length > 1 && (
          <div className="relative">
            <select
              value={vehiculoFiltro}
              onChange={(e) => setVehiculoFiltro(e.target.value)}
              className="w-full appearance-none bg-white border border-gray-300 rounded-xl px-4 py-2.5 pr-10 text-sm text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-sm"
            >
              <option value="">Todos los vehículos</option>
              {vehiculos.map((v) => {
                const tieneDatos = gastoPorVehiculo[v.codigo] !== undefined
                const label = [v.codigo, v.placa, v.apodo].filter(Boolean).join(' — ')
                return (
                  <option key={v.codigo} value={v.codigo}>
                    {label}{!tieneDatos ? ' (sin datos en este período)' : ''}
                  </option>
                )
              })}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
          </div>
        )}

        {error && <ErrorMessage mensaje={error} />}

        {!hayDatos ? (
          <div className="text-center py-12 text-gray-400">
            <span className="text-4xl">💰</span>
            <p className="mt-2 text-sm">
              {vehiculoFiltro ? 'No hay gastos para este vehículo en el período' : 'No hay gastos registrados en este período'}
            </p>
          </div>
        ) : (
          <>
            {/* Stats cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4">
                <p className="text-xl">💰</p>
                <p className="text-xs text-gray-500 mt-1">Gasto total</p>
                <p className="text-lg font-bold text-gray-800 mt-0.5">{formatMoneda(totalGasto)}</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4">
                <p className="text-xl">⛽</p>
                <p className="text-xs text-gray-500 mt-1">Combustible</p>
                <p className="text-lg font-bold text-gray-800 mt-0.5">{formatMoneda(totalCombustible)}</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4">
                <p className="text-xl">🔧</p>
                <p className="text-xs text-gray-500 mt-1">Mantenimiento</p>
                <p className="text-lg font-bold text-gray-800 mt-0.5">{formatMoneda(totalMantenimiento)}</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4">
                <p className="text-xl">🔩</p>
                <p className="text-xs text-gray-500 mt-1">Refacciones y otros</p>
                <p className="text-lg font-bold text-gray-800 mt-0.5">{formatMoneda(totalRefacciones + totalOtros)}</p>
              </div>
            </div>

            {/* Toggle tipo de gráfica */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 shrink-0">Ver gráficas como:</span>
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-1">
                {(['barras', 'tendencia', 'ambas'] as TipoGrafica[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTipoGrafica(t)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      tipoGrafica === t ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    {t === 'barras' ? '▪ Barras' : t === 'tendencia' ? '↗ Tendencia' : '⚡ Ambas'}
                  </button>
                ))}
              </div>
            </div>

            {/* Exportar */}
            <ExportButtons
              onCsv={() => exportarGastosCsv(datosParaExportar())}
              onXlsx={() => exportarGastosXlsx(datosParaExportar())}
              onPdf={() => exportarGastosPdf(datosParaExportar())}
            />

            {/* Gasto por vehículo (apilado por categoría) */}
            {!vehiculoFiltro && vehiculosOrdenados.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">Gasto por vehículo</h2>
                <Chart
                  type={tipoGrafica === 'tendencia' ? 'line' : 'bar'}
                  data={{
                    labels: vehiculosOrdenados.map(labelVehiculo),
                    datasets: buildDatasetsStackedConTendencia(
                      vehiculosOrdenados,
                      [...CATEGORIA_LABELS],
                      gastoPorVehiculo,
                      tipoGrafica
                    ),
                  }}
                  options={(tipoGrafica === 'tendencia' ? chartOptionsConLeyenda : {
                    ...chartOptionsStacked,
                    plugins: {
                      ...chartOptionsStacked.plugins,
                      stackedTotal: {
                        totals: vehiculosOrdenados.map((v) => totalDeFila(gastoPorVehiculo[v])),
                        prefix: '$',
                      },
                    },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  }) as any}
                  plugins={tipoGrafica !== 'tendencia' ? [stackedTotalPlugin] : undefined}
                />
              </div>
            )}

            {/* Gasto por período (apilado por categoría) */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">{labelPeriodo}</h2>
              <Chart
                type={tipoGrafica === 'tendencia' ? 'line' : 'bar'}
                data={{
                  labels: allPeriodKeys,
                  datasets: buildDatasetsStackedConTendencia(
                    allPeriodKeys,
                    [...CATEGORIA_LABELS],
                    gastoPorPeriodo,
                    tipoGrafica
                  ),
                }}
                options={(tipoGrafica === 'tendencia' ? chartOptionsConLeyenda : {
                  ...chartOptionsStacked,
                  plugins: {
                    ...chartOptionsStacked.plugins,
                    stackedTotal: {
                      totals: allPeriodKeys.map((k) => totalDeFila(gastoPorPeriodo[k])),
                      prefix: '$',
                    },
                  },
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                }) as any}
                plugins={tipoGrafica !== 'tendencia' ? [stackedTotalPlugin] : undefined}
              />
            </div>

            {/* Tabla de resumen por vehículo */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Resumen por vehículo</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <th className="px-4 py-2 text-left whitespace-nowrap">Vehículo</th>
                      <th className="px-4 py-2 text-left whitespace-nowrap">Apodo</th>
                      <th className="px-4 py-2 text-right whitespace-nowrap">Combustible</th>
                      <th className="px-4 py-2 text-right whitespace-nowrap">Mantenimiento</th>
                      <th className="px-4 py-2 text-right whitespace-nowrap">Refacciones</th>
                      <th className="px-4 py-2 text-right whitespace-nowrap">Otros</th>
                      <th className="px-4 py-2 text-right whitespace-nowrap">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {resumenVehiculos.map((v) => (
                      <tr key={v.codigo} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium whitespace-nowrap">
                          <div>{v.codigo}</div>
                          {v.placa && <div className="text-xs text-gray-400 font-normal">{v.placa}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{v.apodo ?? '—'}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">{v.combustible ? formatMoneda(v.combustible) : '—'}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">{v.mantenimiento ? formatMoneda(v.mantenimiento) : '—'}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">{v.refacciones ? formatMoneda(v.refacciones) : '—'}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">{v.otros ? formatMoneda(v.otros) : '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{formatMoneda(v.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-xs text-gray-400 text-center pb-6">
              Combustible = litros recargados × precio del litro · Mantenimiento = costo de taller al cerrar el servicio ·
              Solo se incluyen registros con costo capturado dentro del período.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
