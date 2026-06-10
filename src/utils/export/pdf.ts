import { jsPDF } from 'jspdf'
import autoTable, { type UserOptions } from 'jspdf-autotable'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { descargarBlob, nombreArchivo } from './download'

export interface FiltroAplicado {
  etiqueta: string
  valor: string
}

export interface TarjetaResumen {
  etiqueta: string
  valor: string
}

export interface OpcionesTablaPdf {
  /** Índices de columnas alineadas a la derecha (numéricas) */
  columnasDerecha?: number[]
  /** Fila de totales que se muestra como pie de tabla */
  filaTotales?: (string | number)[]
  /** Tamaño de fuente del cuerpo (default 7.5) */
  fontSize?: number
}

const AZUL: [number, number, number] = [37, 99, 235] // blue-600, consistente con la app
const GRIS_TEXTO: [number, number, number] = [55, 65, 81]
const GRIS_SUAVE: [number, number, number] = [243, 244, 246]

/**
 * Constructor de reportes PDF con estilo consistente:
 * encabezado azul, tarjetas de resumen, tablas con autoTable,
 * gráficas como imagen y numeración de páginas.
 */
export class ReportePdf {
  private doc: jsPDF
  private y: number
  private readonly margen = 14
  private readonly anchoPagina: number
  private readonly altoPagina: number

  constructor(titulo: string, orientacion: 'portrait' | 'landscape' = 'portrait') {
    this.doc = new jsPDF({ orientation: orientacion, unit: 'mm', format: 'a4' })
    this.anchoPagina = this.doc.internal.pageSize.getWidth()
    this.altoPagina = this.doc.internal.pageSize.getHeight()

    // Banda de título
    this.doc.setFillColor(...AZUL)
    this.doc.rect(0, 0, this.anchoPagina, 22, 'F')
    this.doc.setTextColor(255, 255, 255)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setFontSize(15)
    this.doc.text(titulo, this.margen, 11)
    this.doc.setFont('helvetica', 'normal')
    this.doc.setFontSize(8.5)
    this.doc.text(
      `Generado el ${format(new Date(), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: es })}`,
      this.margen,
      17.5
    )
    this.y = 29
  }

  private get anchoContenido(): number {
    return this.anchoPagina - this.margen * 2
  }

  /** Salta de página si el bloque de la altura indicada no cabe. */
  private asegurarEspacio(altura: number) {
    if (this.y + altura > this.altoPagina - 14) {
      this.doc.addPage()
      this.y = 16
    }
  }

  /** Línea de filtros aplicados: "Vehículo: VEH-001 · Período: Este mes" */
  agregarFiltros(filtros: FiltroAplicado[]) {
    if (filtros.length === 0) return
    this.asegurarEspacio(10)
    this.doc.setFontSize(8.5)
    this.doc.setTextColor(107, 114, 128)
    const texto = 'Filtros: ' + filtros.map((f) => `${f.etiqueta}: ${f.valor}`).join('  ·  ')
    const lineas = this.doc.splitTextToSize(texto, this.anchoContenido) as string[]
    this.doc.text(lineas, this.margen, this.y)
    this.y += lineas.length * 4 + 4
  }

  /** Tarjetas de totales en fila (máx. 4 por renglón). */
  agregarTarjetas(tarjetas: TarjetaResumen[]) {
    if (tarjetas.length === 0) return
    const porFila = Math.min(tarjetas.length, 4)
    const gap = 4
    const anchoTarjeta = (this.anchoContenido - gap * (porFila - 1)) / porFila
    const altoTarjeta = 16

    for (let i = 0; i < tarjetas.length; i += porFila) {
      const fila = tarjetas.slice(i, i + porFila)
      this.asegurarEspacio(altoTarjeta + 4)
      fila.forEach((t, j) => {
        const x = this.margen + j * (anchoTarjeta + gap)
        this.doc.setFillColor(...GRIS_SUAVE)
        this.doc.roundedRect(x, this.y, anchoTarjeta, altoTarjeta, 2, 2, 'F')
        this.doc.setFontSize(7)
        this.doc.setTextColor(107, 114, 128)
        this.doc.text(t.etiqueta, x + 3, this.y + 5.5)
        this.doc.setFontSize(10.5)
        this.doc.setFont('helvetica', 'bold')
        this.doc.setTextColor(...GRIS_TEXTO)
        this.doc.text(t.valor, x + 3, this.y + 12)
        this.doc.setFont('helvetica', 'normal')
      })
      this.y += altoTarjeta + 4
    }
    this.y += 2
  }

  /** Título de sección. */
  agregarSeccion(titulo: string) {
    this.asegurarEspacio(12)
    this.doc.setFontSize(11)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setTextColor(...GRIS_TEXTO)
    this.doc.text(titulo, this.margen, this.y + 4)
    this.doc.setFont('helvetica', 'normal')
    this.y += 8
  }

  /** Tabla compacta con encabezado azul, filas alternadas y totales opcionales. */
  agregarTabla(encabezados: string[], filas: (string | number)[][], opciones: OpcionesTablaPdf = {}) {
    const columnStyles: UserOptions['columnStyles'] = {}
    for (const idx of opciones.columnasDerecha ?? []) {
      columnStyles[idx] = { halign: 'right' }
    }

    autoTable(this.doc, {
      head: [encabezados],
      body: filas,
      foot: opciones.filaTotales ? [opciones.filaTotales] : undefined,
      startY: this.y,
      margin: { left: this.margen, right: this.margen, top: 16, bottom: 14 },
      styles: {
        fontSize: opciones.fontSize ?? 7.5,
        cellPadding: 1.6,
        textColor: GRIS_TEXTO,
        overflow: 'linebreak',
      },
      headStyles: { fillColor: AZUL, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left' },
      footStyles: { fillColor: GRIS_SUAVE, textColor: GRIS_TEXTO, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles,
    })

    // jspdf-autotable expone la última tabla dibujada en doc.lastAutoTable
    const finalY = (this.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
    this.y = (finalY ?? this.y) + 8
  }

  /**
   * Inserta una gráfica (PNG en data URL) con su título.
   * El bloque título+imagen nunca se parte entre páginas.
   */
  agregarGrafica(titulo: string, dataUrl: string, ratio: number) {
    const anchoImg = this.anchoContenido
    const altoImg = anchoImg * ratio
    this.asegurarEspacio(8 + altoImg + 6)

    this.doc.setFontSize(11)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setTextColor(...GRIS_TEXTO)
    this.doc.text(titulo, this.margen, this.y + 4)
    this.doc.setFont('helvetica', 'normal')
    this.y += 8

    this.doc.addImage(dataUrl, 'PNG', this.margen, this.y, anchoImg, altoImg)
    this.y += altoImg + 6
  }

  /** Nota en gris pequeño. */
  agregarNota(texto: string) {
    this.asegurarEspacio(8)
    this.doc.setFontSize(7.5)
    this.doc.setTextColor(156, 163, 175)
    const lineas = this.doc.splitTextToSize(texto, this.anchoContenido) as string[]
    this.doc.text(lineas, this.margen, this.y + 3)
    this.y += lineas.length * 3.5 + 4
  }

  /** Numera páginas y dispara la descarga. */
  guardar(base: string) {
    const total = this.doc.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i)
      this.doc.setFontSize(7.5)
      this.doc.setTextColor(156, 163, 175)
      this.doc.text(
        `Página ${i} de ${total}`,
        this.anchoPagina - this.margen,
        this.altoPagina - 6,
        { align: 'right' }
      )
      this.doc.text('Control de Recorridos Vehiculares', this.margen, this.altoPagina - 6)
    }
    descargarBlob(this.doc.output('blob'), nombreArchivo(base, 'pdf'))
  }
}
