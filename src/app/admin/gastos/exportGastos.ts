// Exportación de Gastos: resumen procesado (CSV/XLSX) y reporte visual
// con gráficas renderizadas (PDF). Mismo patrón que src/app/indicadores/exportIndicadores.ts.

import { formatMoneda } from '@/utils/formatters'
import { descargarCsvSecciones, type SeccionCsv } from '@/utils/export/csv'
import { descargarXlsx, type HojaExcel } from '@/utils/export/xlsx'
import { ReportePdf, type FiltroAplicado } from '@/utils/export/pdf'
import { renderizarGraficaPng } from '@/utils/export/chartImage'
import type { ChartConfiguration, ChartDataset } from 'chart.js'
import { PALETTE_PERIODOS, type TipoGrafica } from '@/app/indicadores/chartConfig'
import { CATEGORIA_LABELS } from './categorias'

export interface TotalesGastos {
  combustible: number
  mantenimiento: number
  refacciones: number
  otros: number
  total: number
}

export interface ResumenVehiculoGasto {
  codigo: string
  placa: string | null
  apodo: string | null
  combustible: number
  mantenimiento: number
  refacciones: number
  otros: number
  total: number
}

export interface SerieApilada {
  /** Etiquetas del eje X (vehículos o períodos) */
  labels: string[]
  /** Un arreglo de valores por cada categoría, en el mismo orden que CATEGORIA_LABELS */
  porCategoria: number[][]
}

export interface DatosGastos {
  filtros: FiltroAplicado[]
  unidadPeriodo: string
  tipoGrafica: TipoGrafica
  vehiculoFiltrado: boolean
  totales: TotalesGastos
  porVehiculo: SerieApilada
  porPeriodo: SerieApilada
  resumenVehiculos: ResumenVehiculoGasto[]
}

function redondear(valor: number, decimales = 2): number {
  const f = 10 ** decimales
  return Math.round(valor * f) / f
}

function filasResumenGeneral(t: TotalesGastos): (string | number)[][] {
  return [
    ['Gasto total', redondear(t.total)],
    ['Combustible', redondear(t.combustible)],
    ['Mantenimiento', redondear(t.mantenimiento)],
    ['Refacciones', redondear(t.refacciones)],
    ['Otros gastos', redondear(t.otros)],
  ]
}

const ENCABEZADOS_RESUMEN_VEHICULO = [
  'Vehículo', 'Placa', 'Apodo', 'Combustible', 'Mantenimiento', 'Refacciones', 'Otros gastos', 'Total',
]

function filasResumenVehiculos(resumen: ResumenVehiculoGasto[]): (string | number)[][] {
  return resumen.map((v) => [
    v.codigo,
    v.placa ?? '',
    v.apodo ?? '',
    redondear(v.combustible),
    redondear(v.mantenimiento),
    redondear(v.refacciones),
    redondear(v.otros),
    redondear(v.total),
  ])
}

function filasSerieApilada(serie: SerieApilada, etiquetaEje: string): SeccionCsv {
  return {
    encabezados: [etiquetaEje, ...CATEGORIA_LABELS, 'Total'],
    filas: serie.labels.map((l, i) => {
      const valores = serie.porCategoria.map((cat) => redondear(cat[i] ?? 0))
      const total = valores.reduce((a, b) => a + b, 0)
      return [l, ...valores, total]
    }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────────────────────

export function exportarGastosCsv(datos: DatosGastos) {
  const secciones: SeccionCsv[] = [
    {
      titulo: 'Resumen general',
      encabezados: ['Concepto', 'Valor'],
      filas: filasResumenGeneral(datos.totales),
    },
    {
      titulo: 'Resumen por vehículo',
      encabezados: ENCABEZADOS_RESUMEN_VEHICULO,
      filas: filasResumenVehiculos(datos.resumenVehiculos),
    },
    { titulo: 'Gasto por vehículo', ...filasSerieApilada(datos.porVehiculo, 'Vehículo') },
    { titulo: `Gasto ${datos.unidadPeriodo}`, ...filasSerieApilada(datos.porPeriodo, 'Período') },
  ].filter((s) => s.filas.length > 0)

  descargarCsvSecciones('gastos', secciones)
}

// ─────────────────────────────────────────────────────────────────────────────
// XLSX
// ─────────────────────────────────────────────────────────────────────────────

export function exportarGastosXlsx(datos: DatosGastos) {
  const hojaSerie = (nombre: string, serie: SerieApilada, etiquetaEje: string): HojaExcel => {
    const seccion = filasSerieApilada(serie, etiquetaEje)
    return { nombre, encabezados: seccion.encabezados, filas: seccion.filas }
  }

  const hojas: HojaExcel[] = [
    {
      nombre: 'Resumen gastos',
      encabezados: ['Concepto', 'Valor'],
      filas: filasResumenGeneral(datos.totales),
      anchos: [22, 16],
    },
    {
      nombre: 'Resumen por vehículo',
      encabezados: ENCABEZADOS_RESUMEN_VEHICULO,
      filas: filasResumenVehiculos(datos.resumenVehiculos),
    },
    hojaSerie('Datos gasto por vehículo', datos.porVehiculo, 'Vehículo'),
    hojaSerie('Datos gasto por periodo', datos.porPeriodo, 'Período'),
  ].filter((h) => h.filas.length > 0)

  descargarXlsx('gastos', hojas)
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF (con gráficas apiladas por categoría)
// ─────────────────────────────────────────────────────────────────────────────

function configGraficaApilada(
  serie: SerieApilada,
  tipoGrafica: TipoGrafica
): ChartConfiguration {
  // En modo "tendencia" se resume a una sola línea con el total por
  // etiqueta; el desglose apilado por categoría solo aplica a barras.
  if (tipoGrafica === 'tendencia') {
    const totales = serie.labels.map((_, i) =>
      serie.porCategoria.reduce((s, cat) => s + (cat[i] ?? 0), 0)
    )
    return {
      type: 'line',
      data: {
        labels: serie.labels,
        datasets: [{
          label: 'Gasto total',
          data: totales,
          borderColor: 'rgba(5, 150, 105, 0.9)',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: 'rgba(5, 150, 105, 0.9)',
          tension: 0.4,
        }] as ChartDataset[],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    } as ChartConfiguration
  }

  const datasets: ChartDataset[] = CATEGORIA_LABELS.map((label, i) => ({
    type: 'bar' as const,
    label,
    data: serie.porCategoria[i] ?? [],
    backgroundColor: PALETTE_PERIODOS[i % PALETTE_PERIODOS.length],
    stack: 'gasto',
  }))

  return {
    type: 'bar',
    data: { labels: serie.labels, datasets },
    options: {
      plugins: {
        legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 12 } } },
      },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
    },
  } as ChartConfiguration
}

export function exportarGastosPdf(datos: DatosGastos) {
  const reporte = new ReportePdf('Reporte de gastos')

  reporte.agregarFiltros(datos.filtros)

  const t = datos.totales
  reporte.agregarTarjetas([
    { etiqueta: 'Gasto total', valor: formatMoneda(t.total) },
    { etiqueta: 'Combustible', valor: formatMoneda(t.combustible) },
    { etiqueta: 'Mantenimiento', valor: formatMoneda(t.mantenimiento) },
    { etiqueta: 'Refacciones y otros', valor: formatMoneda(t.refacciones + t.otros) },
  ])

  if (!datos.vehiculoFiltrado && datos.porVehiculo.labels.length > 0) {
    const config = configGraficaApilada(datos.porVehiculo, datos.tipoGrafica)
    const imagen = renderizarGraficaPng(config)
    reporte.agregarGrafica('Gasto por vehículo', imagen.dataUrl, imagen.ratio)
  }

  if (datos.porPeriodo.labels.length > 0) {
    const config = configGraficaApilada(datos.porPeriodo, datos.tipoGrafica)
    const imagen = renderizarGraficaPng(config)
    reporte.agregarGrafica(`Gasto ${datos.unidadPeriodo}`, imagen.dataUrl, imagen.ratio)
  }

  reporte.agregarSeccion('Resumen por vehículo')
  reporte.agregarTabla(
    ['Vehículo', 'Placa', 'Apodo', 'Combustible', 'Mantenimiento', 'Refacciones', 'Otros', 'Total'],
    datos.resumenVehiculos.map((v) => [
      v.codigo,
      v.placa ?? '—',
      v.apodo ?? '—',
      v.combustible > 0 ? formatMoneda(v.combustible) : '—',
      v.mantenimiento > 0 ? formatMoneda(v.mantenimiento) : '—',
      v.refacciones > 0 ? formatMoneda(v.refacciones) : '—',
      v.otros > 0 ? formatMoneda(v.otros) : '—',
      formatMoneda(v.total),
    ]),
    {
      columnasDerecha: [3, 4, 5, 6, 7],
      fontSize: 8,
      filaTotales: [
        'Totales', '', '',
        formatMoneda(t.combustible),
        formatMoneda(t.mantenimiento),
        formatMoneda(t.refacciones),
        formatMoneda(t.otros),
        formatMoneda(t.total),
      ],
    }
  )

  reporte.agregarNota(
    'Gasto total = combustible (litros recargados × precio) + mantenimientos (costo de taller) + ' +
    'refacciones + otros gastos. Solo incluye registros con costo capturado dentro del período.'
  )
  reporte.guardar('gastos')
}
