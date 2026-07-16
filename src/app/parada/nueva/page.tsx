import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import FormNuevaParada from './FormNuevaParada'

export default function NuevaParadaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
      <FormNuevaParada />
    </Suspense>
  )
}
