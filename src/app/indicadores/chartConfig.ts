// Configuración de Chart.js compartida entre la vista de Indicadores
// y la exportación a PDF (render offscreen de las mismas gráficas).

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  LineController,
  BarController,
  Title,
  Tooltip,
  Legend,
  type ChartConfiguration,
  type ChartDataset,
  type Plugin,
} from 'chart.js'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, BarController,
  LineElement, LineController, PointElement,
  Title, Tooltip, Legend
)

export type TipoFiltro = 'dia' | 'semana' | 'mes' | 'rango'
export type TipoGrafica = 'barras' | 'tendencia' | 'ambas'

export function buildDatasets(
  data: number[],
  label: string,
  rgba: string,
  tipo: TipoGrafica
) {
  const solid = rgba.replace(/[\d.]+\)$/, '1)')
  const faded = rgba.replace(/[\d.]+\)$/, '0.45)')
  const bar = {
    type: 'bar' as const,
    label,
    data,
    backgroundColor: tipo === 'ambas' ? faded : rgba,
    borderRadius: 6,
  }
  const line = {
    type: 'line' as const,
    label,
    data,
    borderColor: solid,
    backgroundColor: 'transparent',
    borderWidth: 2.5,
    pointRadius: 4,
    pointBackgroundColor: solid,
    tension: 0.4,
  }
  if (tipo === 'barras') return [bar]
  if (tipo === 'tendencia') return [line]
  return [bar, { ...line, label: `${label} (tendencia)` }]
}

export const chartOptions = {
  responsive: true,
  layout: { padding: { top: 24 } },
  plugins: { legend: { display: false } },
  scales: { y: { beginAtZero: true } },
}

export const chartOptionsConLeyenda = {
  responsive: true,
  layout: { padding: { top: 24 } },
  plugins: { legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 11 } } } },
  scales: { y: { beginAtZero: true } },
}

// Paleta para segmentos de período en gráficas apiladas
export const PALETTE_PERIODOS = [
  'rgba(37,  99, 235, 0.78)',
  'rgba(16, 185, 129, 0.78)',
  'rgba(245,158,  11, 0.78)',
  'rgba(139, 92, 246, 0.78)',
  'rgba(239, 68,  68, 0.78)',
  'rgba(20, 184, 166, 0.78)',
  'rgba(249,115,  22, 0.78)',
  'rgba(236, 72, 153, 0.78)',
  'rgba(14, 165, 233, 0.78)',
  'rgba(132,204,  22, 0.78)',
]

/**
 * Construye datasets apilados (uno por período) para gráficas de vehículo.
 * Cada dataset tiene los valores de todos los vehículos en ese período.
 */
export function buildDatasetsStacked(
  vehicleCodes: string[],
  periodoKeys: string[],
  dataMap: Record<string, Record<string, number>>
): ChartDataset[] {
  return periodoKeys.map((pk, i) => ({
    type: 'bar' as const,
    label: pk,
    data: vehicleCodes.map((vc) => dataMap[vc]?.[pk] ?? 0),
    backgroundColor: PALETTE_PERIODOS[i % PALETTE_PERIODOS.length],
    stack: 'vehiculo',
  }))
}

/**
 * Versión extendida: agrega una línea de tendencia sobre los totales
 * cuando tipoGrafica es 'tendencia' o 'ambas'.
 */
export function buildDatasetsStackedConTendencia(
  vehicleCodes: string[],
  periodoKeys: string[],
  dataMap: Record<string, Record<string, number>>,
  tipoGrafica: TipoGrafica
): ChartDataset[] {
  const totals = vehicleCodes.map((vc) =>
    periodoKeys.reduce((sum, pk) => sum + (dataMap[vc]?.[pk] ?? 0), 0)
  )

  const lineDataset: ChartDataset = {
    type: 'line' as const,
    label: 'Total',
    data: totals,
    borderColor: 'rgba(55, 65, 81, 0.9)',
    backgroundColor: 'transparent',
    borderWidth: 2.5,
    pointRadius: 5,
    pointBackgroundColor: 'rgba(55, 65, 81, 0.9)',
    tension: 0.4,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    order: -1 as any,
  }

  if (tipoGrafica === 'tendencia') return [lineDataset]

  const stacked = buildDatasetsStacked(vehicleCodes, periodoKeys, dataMap)
  if (tipoGrafica === 'barras') return stacked
  return [...stacked, lineDataset]
}

/**
 * Plugin que dibuja totales precomputados encima de barras apiladas.
 * Los totales se pasan desde fuera vía options.plugins.stackedTotal.totals
 * para evitar cualquier lectura de datos internos de Chart.js.
 *
 * options.plugins.stackedTotal = {
 *   totals: number[],      // un número por label (vehículo)
 *   prefix?: string,       // '' | '$'
 * }
 */
export const stackedTotalPlugin: Plugin<'bar'> = {
  id: 'stackedTotal',
  afterDatasetsDraw(chart) {
    const { ctx, scales } = chart
    const yScale = scales['y']
    if (!yScale) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = (chart.options as any).plugins?.stackedTotal as
      | { totals?: unknown[]; prefix?: string }
      | undefined
    const totals = opts?.totals
    if (!Array.isArray(totals) || totals.length === 0) return

    const prefix = typeof opts?.prefix === 'string' ? opts.prefix : ''

    for (let i = 0; i < totals.length; i++) {
      const raw = totals[i]
      // Garantizamos que raw es un primitivo numérico antes de cualquier operación
      if (typeof raw !== 'number' || !isFinite(raw) || raw === 0) continue

      // Posición X: leer del primer elemento de barra visible en esta posición
      let barX: number | null = null
      for (let d = 0; d < chart.data.datasets.length; d++) {
        const meta = chart.getDatasetMeta(d)
        if (meta.hidden || meta.type !== 'bar') continue
        const el = meta.data[i]
        if (!el) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const x = (el as any).x
        if (typeof x === 'number') { barX = x; break }
      }
      if (barX === null) continue

      const label = prefix + Math.round(raw).toLocaleString()
      const yTop = yScale.getPixelForValue(raw)
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillStyle = '#374151'
      ctx.font = 'bold 11px sans-serif'
      ctx.fillText(label, barX, yTop - 4)
      ctx.restore()
    }
  },
}

export const chartOptionsStacked = {
  responsive: true,
  layout: { padding: { top: 24 } },
  plugins: {
    legend: {
      display: true,
      position: 'bottom' as const,
      labels: { boxWidth: 12, font: { size: 11 } },
    },
  },
  scales: {
    x: { stacked: true },
    y: { beginAtZero: true, stacked: true },
  },
}

// Colores de cada métrica (mismos que la vista)
export const COLORES_GRAFICAS = {
  kmPorVehiculo: 'rgba(37, 99, 235, 0.7)',
  kmPorPeriodo: 'rgba(16, 185, 129, 0.7)',
  rendimiento: 'rgba(139, 92, 246, 0.7)',
  litrosConsumidos: 'rgba(239, 68, 68, 0.7)',
  litrosRecargados: 'rgba(20, 184, 166, 0.7)',
  costoPorVehiculo: 'rgba(245, 158, 11, 0.7)',
} as const

/**
 * Configuración completa de una gráfica para render offscreen (PDF),
 * respetando el tipo de gráfica elegido por el usuario.
 */
export function configGraficaExport(
  labels: string[],
  values: number[],
  label: string,
  rgba: string,
  tipoGrafica: TipoGrafica
): ChartConfiguration {
  return {
    type: tipoGrafica === 'tendencia' ? 'line' : 'bar',
    data: {
      labels,
      datasets: buildDatasets(values, label, rgba, tipoGrafica) as ChartDataset[],
    },
    options: {
      plugins: {
        legend: tipoGrafica === 'ambas'
          ? { display: true, position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 12 } } }
          : { display: false },
      },
      scales: { y: { beginAtZero: true } },
    },
  } as ChartConfiguration
}
