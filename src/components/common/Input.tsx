'use client'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
}

export default function Input({ label, error, id, className = '', ...props }: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={inputId}
        {...props}
        className={`w-full rounded-xl border px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          error ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-white'
        } ${className}`}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
