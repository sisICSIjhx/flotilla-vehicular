import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import RecorridosAdminView from './RecorridosAdminView'

export default function RecorridosAdminPage() {
  return (
    <PasswordGate title="Administración de Recorridos">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <RecorridosAdminView />
      </Suspense>
    </PasswordGate>
  )
}
