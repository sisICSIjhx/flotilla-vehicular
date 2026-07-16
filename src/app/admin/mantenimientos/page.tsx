import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import MantenimientosAdminView from './MantenimientosAdminView'

export default function MantenimientosAdminPage() {
  return (
    <PasswordGate title="Mantenimientos y Refacciones">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <MantenimientosAdminView />
      </Suspense>
    </PasswordGate>
  )
}
