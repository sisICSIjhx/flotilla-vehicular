import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import IndicadoresView from './IndicadoresView'

export default function IndicadoresPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
      <IndicadoresView />
    </Suspense>
  )
}
