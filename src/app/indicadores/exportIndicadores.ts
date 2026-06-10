// Exportación de Indicadores: resumen procesado + datos fuente de cada
// gráfica (CSV/XLSX) y reporte visual con gráficas renderizadas (PDF).

import { formatMoneda, formatDecimal } from '@/utils/formatters'
import { descargarCsvSecciones, type SeccionCsv } from '@/utils/export/csv'
import { descargarXlsx, type HojaExcel } from '@/utils/export/xlsx'
import { ReportePdf, type FiltroAplicado } from '@/utils/export/pdf'
import { renderizarGraficaPng } from '@/utils/export/chartImage'
import { configGraficaExport, COLORES_GRAFICAS, type TipoGrafica } from './chartConfig'

export interface SerieDatos {
  labels: string[]
  values: number[]
}

export interface ResumenVehiculo {
  codigo: string
  placa: string | null
  apodo: string | null
  km: number
  litrosCargados: number
  litrosConsumidos: number
  rendimiento: number | null
  costo: number
}

export interface TotalesIndicadores {
  recorridos: number
  km: number
  litrosRecargados: number
  litrosConsumidos: number
  costo: number
  rendimientoPromedio: number | null
}

export interface DatosIndicadores {
  /** Filtros activos descritos en texto (período, vehículo) */
  filtros: FiltroAplicado[]
  /** Etiqueta de agrupación temporal: 'por día' o 'por mes' */
  unidadPeriodo: string
  tipoGrafica: TipoGrafica
  /** Hay filtro de vehículo activo (oculta las gráficas por vehículo) */
  vehiculoFiltrado: boolean
  totales: TotalesIndicadores
  kmPorVehiculo: SerieDatos
  kmPorPeriodo: SerieDatos
  rendimientoPorPeriodo: SerieDatos
  litrosConsumidosPorPeriodo: SerieDatos
  litrosRecargadosPorPeriodo: SerieDatos
  costoPorVehiculo: SerieDatos
  resumenVehiculos: ResumenVehiculo[]
}

function redondear(valor: number, decimales = 2): number {
  const f = 10 ** decimales
  return Math.round(valor * f) / f
}

// ─────────────────────────────────────────────────────────────────────────────
// Filas comunes
// ─────────────────────────────────────────────────────────────────────────────

function filasResumenGeneral(t: TotalesIndicadores): (string | number)[][] {
  return [
    ['Recorridos cerrados', t.recorridos],
    ['KM totales', t.km],
    ['Litros recargados', redondear(t.litrosRecargados, 3)],
    ['Litros consumidos', redondear(t.litrosConsumidos, 3)],
    ['Costo total combustible', redondear(t.costo)],
    ['Rendimiento promedio (km/L)', t.rendimientoPromedio != null ? redondear(t.rendimientoPromedio) : '—'],
  ]
}

const ENCABEZADOS_RESUMEN_VEHICULO = [
  'Vehículo', 'Placa', 'Apodo', 'KM', 'Litros recargados', 'Litros consumidos',
  'Rendimiento (km/L)', 'Costo combustible',
]

function filasResumenVehiculos(resumen: ResumenVehiculo[]): (string | number)[][] {
  return resumen.map((v) => [
    v.codigo,
    v.placa ?? '',
    v.apodo ?? '',
    v.km,
    v.litrosCargados > 0 ? redondear(v.litrosCargados, 3) : '',
    v.litrosConsumidos > 0 ? redondear(v.litrosConsumidos, 3) : '',
    v.rendimiento != null ? redondear(v.rendimiento) : '',
    v.costo > 0 ? redondear(v.costo) : '',
  ])
}

function filasSerie(serie: SerieDatos, etiqueta: string, valor: string): SeccionCsv {
  return {
    encabezados: [etiqueta, valor],
    filas: serie.labels.map((l, i) => [l, redondear(serie.values[i] ?? 0)]),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────────────────────

export function exportarIndicadoresCsv(datos: DatosIndicadores) {
  const secciones: SeccionCsv[] = [
    {
      titulo: 'Resumen general',
      encabezados: ['Indicador', 'Valor'],
      filas: filasResumenGeneral(datos.totales),
    },
    {
      titulo: 'Resumen por vehículo',
      encabezados: ENCABEZADOS_RESUMEN_VEHICULO,
      filas: filasResumenVehiculos(datos.resumenVehiculos),
    },
    { titulo: 'KM por vehículo', ...filasSerie(datos.kmPorVehiculo, 'Vehículo', 'KM') },
    { titulo: `KM ${datos.unidadPeriodo}`, ...filasSerie(datos.kmPorPeriodo, 'Período', 'KM') },
    { titulo: `Rendimiento ${datos.unidadPeriodo} (km/L)`, ...filasSerie(datos.rendimientoPorPeriodo, 'Período', 'km/L') },
    { titulo: `Litros consumidos ${datos.unidadPeriodo}`, ...filasSerie(datos.litrosConsumidosPorPeriodo, 'Período', 'Litros') },
    { titulo: `Litros recargados ${datos.unidadPeriodo}`, ...filasSerie(datos.litrosRecargadosPorPeriodo, 'Período', 'Litros') },
    { titulo: 'Costo de combustible por vehículo', ...filasSerie(datos.costoPorVehiculo, 'Vehículo', 'Costo') },
  ].filter((s) => s.filas.length > 0)

  descargarCsvSecciones('indicadores', secciones)
}

// ─────────────────────────────────────────────────────────────────────────────
// XLSX
// ─────────────────────────────────────────────────────────────────────────────

export function exportarIndicadoresXlsx(datos: DatosIndicadores) {
  const hojaSerie = (nombre: string, serie: SerieDatos, etiqueta: string, valor: string): HojaExcel => ({
    nombre,
    encabezados: [etiqueta, valor],
    filas: serie.labels.map((l, i) => [l, redondear(serie.values[i] ?? 0)]),
    anchos: [28, 14],
  })

  const hojas: HojaExcel[] = [
    {
      nombre: 'Resumen indicadores',
      encabezados: ['Indicador', 'Valor'],
      filas: filasResumenGeneral(datos.totales),
      anchos: [30, 16],
    },
    {
      nombre: 'Resumen por vehículo',
      encabezados: ENCABEZADOS_RESUMEN_VEHICULO,
      filas: filasResumenVehiculos(datos.resumenVehiculos),
    },
    hojaSerie('Datos KM por vehículo', datos.kmPorVehiculo, 'Vehículo', 'KM'),
    hojaSerie('Datos KM por periodo', datos.kmPorPeriodo, 'Período', 'KM'),
    hojaSerie('Datos rendimiento', datos.rendimientoPorPeriodo, 'Período', 'Rendimiento (km/L)'),
    hojaSerie('Datos litros consumidos', datos.litrosConsumidosPorPeriodo, 'Período', 'Litros consumidos'),
    hojaSerie('Datos litros recargados', datos.litrosRecargadosPorPeriodo, 'Período', 'Litros recargados'),
    hojaSerie('Datos costo por vehículo', datos.costoPorVehiculo, 'Vehículo', 'Costo ($)'),
  ].filter((h) => h.filas.length > 0)

  descargarXlsx('indicadores', hojas)
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF (con gráficas)
// ─────────────────────────────────────────────────────────────────────────────

export function exportarIndicadoresPdf(datos: DatosIndicadores) {
  const reporte = new ReportePdf('Reporte de indicadores')

  reporte.agregarFiltros(datos.filtros)

  const t = datos.totales
  reporte.agregarTarjetas([
    { etiqueta: 'Recorridos', valor: String(t.recorridos) },
    { etiqueta: 'KM totales', valor: t.km.toLocaleString() },
    { etiqueta: 'Costo total', valor: formatMoneda(t.costo) },
    {
      etiqueta: 'Rendimiento promedio',
      valor: t.rendimientoPromedio != null ? `${formatDecimal(t.rendimientoPromedio, 2)} km/L` : '—',
    },
  ])

  // Gráficas: mismas series, colores y tipo de gráfica que la vista.
  // Cada bloque título+imagen se mantiene completo (sin partirse entre páginas).
  const graficas: { titulo: string; serie: SerieDatos; label: string; color: string; visible: boolean }[] = [
    {
      titulo: 'KM por vehículo',
      serie: datos.kmPorVehiculo,
      label: 'KM recorridos',
      color: COLORES_GRAFICAS.kmPorVehiculo,
      visible: !datos.vehiculoFiltrado,
    },
    {
      titulo: `KM ${datos.unidadPeriodo}`,
      serie: datos.kmPorPeriodo,
      label: `KM ${datos.unidadPeriodo}`,
      color: COLORES_GRAFICAS.kmPorPeriodo,
      visible: true,
    },
    {
      titulo: `Rendimiento ${datos.unidadPeriodo} (km/L)`,
      serie: datos.rendimientoPorPeriodo,
      label: 'km/L',
      color: COLORES_GRAFICAS.rendimiento,
      visible: true,
    },
    {
      titulo: `Litros consumidos ${datos.unidadPeriodo}`,
      serie: datos.litrosConsumidosPorPeriodo,
      label: 'Litros consumidos',
      color: COLORES_GRAFICAS.litrosConsumidos,
      visible: true,
    },
    {
      titulo: `Litros recargados ${datos.unidadPeriodo}`,
      serie: datos.litrosRecargadosPorPeriodo,
      label: 'Litros recargados',
      color: COLORES_GRAFICAS.litrosRecargados,
      visible: true,
    },
    {
      titulo: 'Costo de combustible por vehículo',
      serie: datos.costoPorVehiculo,
      label: 'Costo ($)',
      color: COLORES_GRAFICAS.costoPorVehiculo,
      visible: !datos.vehiculoFiltrado && t.costo > 0,
    },
  ]

  for (const g of graficas) {
    if (!g.visible || g.serie.labels.length === 0) continue
    const config = configGraficaExport(g.serie.labels, g.serie.values, g.label, g.color, datos.tipoGrafica)
    const imagen = renderizarGraficaPng(config)
    reporte.agregarGrafica(g.titulo, imagen.dataUrl, imagen.ratio)
  }

  // Tabla resumen por vehículo
  reporte.agregarSeccion('Resumen por vehículo')
  reporte.agregarTabla(
    ['Vehículo', 'Placa', 'Apodo', 'KM', 'L. recargados', 'L. consumidos', 'Rend.', 'Costo'],
    datos.resumenVehiculos.map((v) => [
      v.codigo,
      v.placa ?? '—',
      v.apodo ?? '—',
      v.km.toLocaleString(),
      v.litrosCargados > 0 ? formatDecimal(v.litrosCargados) : '—',
      v.litrosConsumidos > 0 ? formatDecimal(v.litrosConsumidos) : '—',
      v.rendimiento != null ? `${formatDecimal(v.rendimiento, 2)} km/L` : '—',
      v.costo > 0 ? formatMoneda(v.costo) : '—',
    ]),
    {
      columnasDerecha: [3, 4, 5, 6, 7],
      fontSize: 8,
      filaTotales: [
        'Totales', '', '',
        t.km.toLocaleString(),
        formatDecimal(t.litrosRecargados),
        formatDecimal(t.litrosConsumidos),
        t.rendimientoPromedio != null ? `${formatDecimal(t.rendimientoPromedio, 2)} km/L` : '—',
        formatMoneda(t.costo),
      ],
    }
  )

  reporte.agregarNota(
    'Solo recorridos cerrados · Litros consumidos = balance real del tanque · ' +
    'Litros recargados = carga en gasolinera.'
  )
  reporte.guardar('indicadores')
}
