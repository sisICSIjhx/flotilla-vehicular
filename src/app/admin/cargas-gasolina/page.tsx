import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import CargasGasolinaAdminView from './CargasGasolinaAdminView'

export default function CargasGasolinaAdminPage() {
  return (
    <PasswordGate title="Administración de Cargas de Gasolina">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <CargasGasolinaAdminView />
      </Suspense>
    </PasswordGate>
  )
}
