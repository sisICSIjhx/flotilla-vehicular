import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import SolicitudesView from './SolicitudesView'

export default function SolicitudesPage() {
  return (
    <PasswordGate title="Solicitudes de Combustible">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <SolicitudesView />
      </Suspense>
    </PasswordGate>
  )
}
