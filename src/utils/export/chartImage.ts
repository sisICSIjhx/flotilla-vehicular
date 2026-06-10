import { Chart as ChartJS, type ChartConfiguration } from 'chart.js'

/**
 * Plugin que pinta fondo blanco antes de dibujar la gráfica
 * (evita fondos negros/transparentes al incrustar el PNG en PDF).
 */
const fondoBlanco = {
  id: 'fondoBlanco',
  beforeDraw(chart: ChartJS) {
    const { ctx } = chart
    ctx.save()
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, chart.width, chart.height)
    ctx.restore()
  },
}

export interface ImagenGrafica {
  /** PNG en data URL */
  dataUrl: string
  /** relación alto/ancho para escalar en el PDF */
  ratio: number
}

/**
 * Renderiza una configuración de Chart.js en un canvas fuera de pantalla
 * a resolución 2x y devuelve la imagen PNG resultante.
 *
 * Se usa para incrustar gráficas nítidas en los PDF sin depender del
 * tamaño/densidad de pantalla del dispositivo.
 */
export function renderizarGraficaPng(
  config: ChartConfiguration,
  ancho = 900,
  alto = 460
): ImagenGrafica {
  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = alto

  const chart = new ChartJS(canvas, {
    ...config,
    options: {
      ...config.options,
      responsive: false,
      animation: false,
      devicePixelRatio: 2,
    },
    plugins: [...(config.plugins ?? []), fondoBlanco],
  })

  try {
    const dataUrl = chart.toBase64Image('image/png', 1)
    return { dataUrl, ratio: alto / ancho }
  } finally {
    chart.destroy()
  }
}
