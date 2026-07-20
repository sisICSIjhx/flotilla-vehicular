import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import HistorialView from './HistorialView'

export default function HistorialMantenimientoPage() {
  return (
    <PasswordGate title="Historial de taller">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <HistorialView />
      </Suspense>
    </PasswordGate>
  )
}
