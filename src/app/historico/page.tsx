import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import HistoricoView from './HistoricoView'

export default function HistoricoPage() {
  return (
    <PasswordGate title="Histórico de Recorridos">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <HistoricoView />
      </Suspense>
    </PasswordGate>
  )
}
