'use client'

interface SelectOption {
  value: string | number
  label: string
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: SelectOption[]
  error?: string
  placeholder?: string
}

export default function Select({
  label,
  options,
  error,
  placeholder = 'Selecciona una opción',
  id,
  className = '',
  ...props
}: SelectProps) {
  const selectId = id ?? label.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="space-y-1">
      <label htmlFor={selectId} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <select
        id={selectId}
        {...props}
        className={`w-full rounded-xl border px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white ${
          error ? 'border-red-500 bg-red-50' : 'border-gray-300'
        } ${className}`}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
