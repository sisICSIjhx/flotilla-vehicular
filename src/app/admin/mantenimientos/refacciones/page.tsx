import { Suspense } from 'react'
import Loading from '@/components/common/Loading'
import PasswordGate from '@/components/common/PasswordGate'
import GastosView from '../GastosView'

export default function RefaccionesPage() {
  return (
    <PasswordGate title="Refacciones">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading /></div>}>
        <GastosView categoria="refaccion" />
      </Suspense>
    </PasswordGate>
  )
}
