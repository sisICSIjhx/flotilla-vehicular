import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import FormSalida from './FormSalida'

export default function SalidaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
      <FormSalida />
    </Suspense>
  )
}
