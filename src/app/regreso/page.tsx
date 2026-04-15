import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import FormRegreso from './FormRegreso'

export default function RegresoPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
      <FormRegreso />
    </Suspense>
  )
}
