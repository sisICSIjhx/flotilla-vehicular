'use client'

import { useEffect, useRef, useState } from 'react'

interface QRScannerProps {
  onScan: (vehiculoCodigo: string) => void
}

export default function QRScanner({ onScan }: QRScannerProps) {
  const [error, setError] = useState<string | null>(null)
  const initialized = useRef(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null)
  const onScanRef = useRef(onScan)

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    import('html5-qrcode')
      .then(({ Html5QrcodeScanner }) => {
        const scanner = new Html5QrcodeScanner(
          'qr-reader',
          { fps: 10, qrbox: 250, rememberLastUsedCamera: true },
          /* verbose= */ false
        )

        scanner.render(
          (text: string) => {
            // Acepta URL completa o solo el código
            const match = text.match(/\/vehiculo\/([^/?#\s]+)/)
            const codigo = match ? match[1] : text.trim()
            scanner.clear().catch(() => {})
            onScanRef.current(codigo)
          },
          () => {
            // Errores de frame son normales durante el escaneo, ignorar
          }
        )

        scannerRef.current = scanner
      })
      .catch(() => {
        setError('No se pudo cargar el escáner. Verifica los permisos de cámara.')
      })

    return () => {
      scannerRef.current?.clear().catch(() => {})
    }
  }, [])

  if (error) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-6 text-center text-sm text-red-700">
        {error}
      </div>
    )
  }

  return <div id="qr-reader" className="w-full max-w-sm mx-auto" />
}
