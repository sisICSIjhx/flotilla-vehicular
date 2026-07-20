import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import UnidadesView from './UnidadesView'

export default function UnidadesMantenimientoPage() {
  return (
    <PasswordGate title="Estado de unidades">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <UnidadesView />
      </Suspense>
    </PasswordGate>
  )
}
