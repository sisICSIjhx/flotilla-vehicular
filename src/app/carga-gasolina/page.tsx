import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import FormCargaGasolina from './FormCargaGasolina'

export default function CargaGasolinaPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loading texto="Cargando..." />
        </div>
      }
    >
      <FormCargaGasolina />
    </Suspense>
  )
}
