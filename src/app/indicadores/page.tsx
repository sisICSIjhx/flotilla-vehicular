import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import IndicadoresView from './IndicadoresView'

export default function IndicadoresPage() {
  return (
    <PasswordGate title="Indicadores y Estadísticas">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <IndicadoresView />
      </Suspense>
    </PasswordGate>
  )
}
