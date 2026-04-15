import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import FormParada from './FormParada'

export default function ParadaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
      <FormParada />
    </Suspense>
  )
}
