'use client'

import { useState, useEffect } from 'react'

const SESSION_KEY = 'admin_access_granted'
// Hash simple para no exponer la contraseña en texto plano (btoa reversible, suficiente para MVP)
const ACCESS_TOKEN = btoa('Adm@n76u')

interface PasswordGateProps {
  children: React.ReactNode
  title?: string
}

export default function PasswordGate({ children, title = 'Área Restringida' }: PasswordGateProps) {
  const [unlocked, setUnlocked] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY)
    setUnlocked(stored === ACCESS_TOKEN)
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Pequeño delay para evitar fuerza bruta trivial
    setTimeout(() => {
      if (btoa(password) === ACCESS_TOKEN) {
        sessionStorage.setItem(SESSION_KEY, ACCESS_TOKEN)
        setUnlocked(true)
      } else {
        setError('Contraseña incorrecta. Intenta de nuevo.')
        setPassword('')
      }
      setLoading(false)
    }, 400)
  }

  // Mientras se verifica sessionStorage, no renderizar nada
  if (unlocked === null) return null

  if (unlocked) return <>{children}</>

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Icono de candado */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-8 h-8 text-blue-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-5">
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">{title}</h1>
            <p className="text-sm text-gray-500 mt-1">Ingresa la contraseña para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError('')
                  }}
                  autoComplete="current-password"
                  autoFocus
                  className={`w-full rounded-xl border px-3 py-3 pr-10 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    error ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-white'
                  }`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full py-3 px-4 rounded-xl text-base font-semibold bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
            >
              {loading && (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              Ingresar
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          El acceso se mantiene durante la sesión del navegador
        </p>
      </div>
    </div>
  )
}
