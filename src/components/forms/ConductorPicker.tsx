'use client'

import { supabase, type Conductor } from '@/lib/supabase'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'

// Patrón compartido "select de catálogo ↔ captura manual" para conductores.

export interface ConductorValue {
  mode: 'lista' | 'manual'
  conductorId: string
  nombre: string
}

export const CONDUCTOR_VACIO: ConductorValue = { mode: 'lista', conductorId: '', nombre: '' }

export function conductorValido(value: ConductorValue): boolean {
  return value.mode === 'lista' ? Boolean(value.conductorId) : Boolean(value.nombre.trim())
}

export async function resolverConductorId(value: ConductorValue): Promise<number> {
  if (value.mode === 'lista') return Number(value.conductorId)
  const { data, error } = await supabase.rpc('get_or_create_conductor', {
    p_nombre: value.nombre.trim(),
  })
  if (error) throw new Error(error.message)
  return data as number
}

interface ConductorPickerProps {
  label?: string
  conductores: Pick<Conductor, 'id' | 'nombre'>[]
  value: ConductorValue
  onChange: (value: ConductorValue) => void
  error?: string
}

export default function ConductorPicker({
  label = 'Conductor',
  conductores,
  value,
  onChange,
  error,
}: ConductorPickerProps) {
  return (
    <div className="space-y-1">
      {value.mode === 'lista' ? (
        <Select
          label={label}
          value={value.conductorId}
          onChange={(e) => onChange({ ...value, conductorId: e.target.value })}
          options={conductores.map((c) => ({ value: c.id, label: c.nombre }))}
          placeholder="Selecciona el conductor"
          error={error}
        />
      ) : (
        <Input
          label={label}
          type="text"
          value={value.nombre}
          onChange={(e) => onChange({ ...value, nombre: e.target.value })}
          placeholder="Escribe el nombre completo"
          error={error}
        />
      )}
      <button
        type="button"
        onClick={() => onChange({ mode: value.mode === 'lista' ? 'manual' : 'lista', conductorId: '', nombre: '' })}
        className="text-xs text-blue-600 hover:text-blue-800"
      >
        {value.mode === 'lista' ? '¿No está en la lista? Escribir nombre' : 'Seleccionar de la lista'}
      </button>
    </div>
  )
}
