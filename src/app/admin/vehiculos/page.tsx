import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import VehiculosAdminView from './VehiculosAdminView'

export default function VehiculosAdminPage() {
  return (
    <PasswordGate title="Administración de Vehículos">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <VehiculosAdminView />
      </Suspense>
    </PasswordGate>
  )
}
