import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import HistorialSolicitudesView from './HistorialSolicitudesView'

export default function HistorialSolicitudesPage() {
  return (
    <PasswordGate title="Historial de cambios">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <HistorialSolicitudesView />
      </Suspense>
    </PasswordGate>
  )
}
