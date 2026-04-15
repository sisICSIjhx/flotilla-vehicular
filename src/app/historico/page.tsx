import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import HistoricoView from './HistoricoView'

export default function HistoricoPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
      <HistoricoView />
    </Suspense>
  )
}
