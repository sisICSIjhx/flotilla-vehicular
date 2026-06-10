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
  plugins: { legend: { display: false } },
  scales: { y: { beginAtZero: true } },
}

export const chartOptionsConLeyenda = {
  responsive: true,
  plugins: { legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 11 } } } },
  scales: { y: { beginAtZero: true } },
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
