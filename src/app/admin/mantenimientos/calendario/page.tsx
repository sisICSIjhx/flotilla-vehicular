import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import CalendarioView from './CalendarioView'

export default function CalendarioMantenimientoPage() {
  return (
    <PasswordGate title="Calendario de mantenimientos">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <CalendarioView />
      </Suspense>
    </PasswordGate>
  )
}
