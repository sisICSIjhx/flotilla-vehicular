'use client'

import { useState, useRef } from 'react'

interface PhotoCaptureProps {
  onPhoto: (file: File) => void
  label?: string
  error?: string
}

export default function PhotoCapture({
  onPhoto,
  label = 'Foto del tablero',
  error,
}: PhotoCaptureProps) {
  const [preview, setPreview] = useState<string | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    onPhoto(file)
  }

  function handleRetake() {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    if (cameraRef.current) cameraRef.current.value = ''
    if (galleryRef.current) galleryRef.current.value = ''
  }

  return (
    <div className="space-y-1">
      <p className="block text-sm font-medium text-gray-700">{label}</p>

      {preview ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Vista previa"
            className="w-full rounded-xl border border-gray-300 max-h-52 object-cover"
          />
          <button
            type="button"
            onClick={handleRetake}
            className="text-sm text-blue-600 underline"
          >
            Cambiar imagen
          </button>
        </div>
      ) : (
        <div
          className={`flex flex-col items-center justify-center w-full border-2 border-dashed rounded-xl bg-gray-50 py-5 gap-3 ${
            error ? 'border-red-400' : 'border-gray-300'
          }`}
        >
          <span className="text-3xl">📷</span>
          <p className="text-sm text-gray-500">Elige una opción</p>
          <div className="flex gap-3">
            {/* Botón cámara */}
            <label className="cursor-pointer">
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Cámara
              </div>
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleChange}
              />
            </label>

            {/* Botón galería / archivos */}
            <label className="cursor-pointer">
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-300 hover:bg-gray-50 active:bg-gray-100 text-gray-700 text-sm font-medium transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Galería
              </div>
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleChange}
              />
            </label>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
