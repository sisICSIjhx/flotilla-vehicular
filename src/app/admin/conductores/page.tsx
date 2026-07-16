import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import ConductoresAdminView from './ConductoresAdminView'

export default function ConductoresAdminPage() {
  return (
    <PasswordGate title="Administración de Conductores">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <ConductoresAdminView />
      </Suspense>
    </PasswordGate>
  )
}
