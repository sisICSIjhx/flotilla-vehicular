'use client'

import { useState } from 'react'

interface ExportExcelButtonProps {
  onExport: () => Promise<void> | void
  /** Deshabilita el botón (p. ej. cuando no hay datos con los filtros actuales) */
  deshabilitado?: boolean
  label?: string
}

/**
 * Botón único "Descargar Excel" con estado de carga y manejo de errores.
 * Mismo estilo que ExportButtons, para pantallas que solo necesitan XLSX.
 */
export default function ExportExcelButton({
  onExport,
  deshabilitado,
  label = 'Descargar Excel',
}: ExportExcelButtonProps) {
  const [exportando, setExportando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function exportar() {
    setExportando(true)
    setError(null)
    try {
      await onExport()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar el archivo')
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={exportar}
        disabled={deshabilitado || exportando}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-start"
      >
        {exportando ? (
          <span className="w-3.5 h-3.5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
          </svg>
        )}
        {exportando ? 'Generando…' : label}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
