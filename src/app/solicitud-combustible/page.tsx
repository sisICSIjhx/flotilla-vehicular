import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import FormSolicitudCombustible from './FormSolicitudCombustible'

export default function SolicitudCombustiblePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loading texto="Cargando..." />
        </div>
      }
    >
      <FormSolicitudCombustible />
    </Suspense>
  )
}
