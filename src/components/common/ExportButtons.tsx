'use client'

import { useState } from 'react'

type Formato = 'csv' | 'xlsx' | 'pdf'

interface ExportButtonsProps {
  onCsv: () => Promise<void> | void
  onXlsx: () => Promise<void> | void
  onPdf: () => Promise<void> | void
  /** Deshabilita los tres botones (p. ej. cuando no hay datos) */
  deshabilitado?: boolean
}

const BOTONES: { formato: Formato; label: string }[] = [
  { formato: 'csv', label: 'CSV' },
  { formato: 'xlsx', label: 'Excel' },
  { formato: 'pdf', label: 'PDF' },
]

/**
 * Grupo de botones "Descargar CSV / Excel / PDF" con estado de carga
 * y manejo de errores. Reutilizable en Histórico e Indicadores.
 */
export default function ExportButtons({ onCsv, onXlsx, onPdf, deshabilitado }: ExportButtonsProps) {
  const [exportando, setExportando] = useState<Formato | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handlers: Record<Formato, () => Promise<void> | void> = {
    csv: onCsv,
    xlsx: onXlsx,
    pdf: onPdf,
  }

  async function exportar(formato: Formato) {
    setExportando(formato)
    setError(null)
    try {
      await handlers[formato]()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar el archivo')
    } finally {
      setExportando(null)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 shrink-0">Descargar:</span>
        {BOTONES.map(({ formato, label }) => (
          <button
            key={formato}
            onClick={() => exportar(formato)}
            disabled={deshabilitado || exportando !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportando === formato ? (
              <span className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
              </svg>
            )}
            {exportando === formato ? 'Generando…' : label}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
