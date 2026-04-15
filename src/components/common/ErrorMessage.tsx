export default function ErrorMessage({ mensaje }: { mensaje: string }) {
  return (
    <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
      {mensaje}
    </div>
  )
}
