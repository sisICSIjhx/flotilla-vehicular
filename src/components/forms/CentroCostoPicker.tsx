'use client'

import { supabase, type CentroCosto } from '@/lib/supabase'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'

// Patrón compartido "select de catálogo ↔ captura manual" para
// centros de costo (antes duplicado en FormSalida, FormCargaGasolina
// y FormSolicitudCombustible).

export interface CentroCostoValue {
  mode: 'lista' | 'manual'
  centroId: string
  nombre: string
}

export const CENTRO_COSTO_VACIO: CentroCostoValue = { mode: 'lista', centroId: '', nombre: '' }

export function centroCostoValido(value: CentroCostoValue): boolean {
  return value.mode === 'lista' ? Boolean(value.centroId) : Boolean(value.nombre.trim())
}

// Devuelve el id del centro: directo si viene de la lista,
// o creándolo vía RPC si es captura manual.
export async function resolverCentroCostoId(value: CentroCostoValue): Promise<number> {
  if (value.mode === 'lista') return Number(value.centroId)
  const { data, error } = await supabase.rpc('get_or_create_centro_costo', {
    p_nombre: value.nombre.trim(),
  })
  if (error) throw new Error(error.message)
  return data as number
}

interface CentroCostoPickerProps {
  label?: string
  centros: Pick<CentroCosto, 'id' | 'nombre'>[]
  value: CentroCostoValue
  onChange: (value: CentroCostoValue) => void
  error?: string
  placeholder?: string
}

export default function CentroCostoPicker({
  label = 'Destino / Centro de costo',
  centros,
  value,
  onChange,
  error,
  placeholder = 'Selecciona el destino',
}: CentroCostoPickerProps) {
  return (
    <div className="space-y-1">
      {value.mode === 'lista' ? (
        <Select
          label={label}
          value={value.centroId}
          onChange={(e) => onChange({ ...value, centroId: e.target.value })}
          options={centros.map((c) => ({ value: c.id, label: c.nombre }))}
          placeholder={placeholder}
          error={error}
        />
      ) : (
        <Input
          label={label}
          type="text"
          value={value.nombre}
          onChange={(e) => onChange({ ...value, nombre: e.target.value })}
          placeholder="Escribe el nombre del destino"
          error={error}
        />
      )}
      <button
        type="button"
        onClick={() => onChange({ mode: value.mode === 'lista' ? 'manual' : 'lista', centroId: '', nombre: '' })}
        className="text-xs text-blue-600 hover:text-blue-800"
      >
        {value.mode === 'lista' ? '¿No está en la lista? Escribir destino' : 'Seleccionar de la lista'}
      </button>
    </div>
  )
}
