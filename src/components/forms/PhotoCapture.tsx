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
  const inputRef = useRef<HTMLInputElement>(null)

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
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-1">
      <p className="block text-sm font-medium text-gray-700">{label}</p>

      {preview ? (
        <div className="space-y-2">
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
            Tomar otra foto
          </button>
        </div>
      ) : (
        <label className="block cursor-pointer">
          <div
            className={`flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200 transition-colors ${
              error ? 'border-red-400' : 'border-gray-300'
            }`}
          >
            <span className="text-3xl">📷</span>
            <span className="text-sm text-gray-500 mt-2">Toca para capturar</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleChange}
          />
        </label>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
