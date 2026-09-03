import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import GastosView from './GastosView'

export default function GastosPage() {
  return (
    <PasswordGate title="Gastos">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <GastosView />
      </Suspense>
    </PasswordGate>
  )
}
