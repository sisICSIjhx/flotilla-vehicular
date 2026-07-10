import Link from 'next/link'

export default function GasolinaPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-green-600 text-white px-4 py-5 shadow">
        <div className="max-w-md mx-auto w-full flex items-center gap-3">
          <Link href="/" className="text-green-200 hover:text-white transition-colors" aria-label="Volver al inicio">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Gasolina</h1>
            <p className="text-green-100 text-sm mt-0.5">Elige una sección</p>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col gap-4 px-4 py-6 max-w-md mx-auto w-full">
        {/* Card: Administración de cargas */}
        <Link
          href="/admin/cargas-gasolina"
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex items-center gap-4 hover:border-green-300 hover:shadow transition"
        >
          <span className="text-4xl">⛽</span>
          <div className="flex-1">
            <h2 className="text-gray-800 font-semibold">Administración de cargas de gasolina</h2>
            <p className="text-gray-500 text-sm mt-0.5">
              Consulta y administra las cargas de gasolina registradas.
            </p>
          </div>
          <span className="text-gray-400 text-xl">›</span>
        </Link>

        {/* Card: Solicitudes */}
        <Link
          href="/solicitudes"
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex items-center gap-4 hover:border-green-300 hover:shadow transition"
        >
          <span className="text-4xl">📄</span>
          <div className="flex-1">
            <h2 className="text-gray-800 font-semibold">Solicitudes de combustible</h2>
            <p className="text-gray-500 text-sm mt-0.5">
              Revisa y gestiona las solicitudes de combustible.
            </p>
          </div>
          <span className="text-gray-400 text-xl">›</span>
        </Link>
      </main>
    </div>
  )
}
