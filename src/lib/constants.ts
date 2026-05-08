// Combustible: SMALLINT 0-8 en BD
// 0=Reserva (~10%), 1=1/8, 2=1/4, 3=3/8, 4=1/2, 5=5/8, 6=3/4, 7=7/8, 8=Lleno
export const COMBUSTIBLE_NIVELES = [
  { value: 0, label: 'Reserva' },
  { value: 1, label: '1/8' },
  { value: 2, label: '1/4' },
  { value: 3, label: '3/8' },
  { value: 4, label: '1/2' },
  { value: 5, label: '5/8' },
  { value: 6, label: '3/4' },
  { value: 7, label: '7/8' },
  { value: 8, label: 'Lleno' },
] as const

export type CombustibleValue = (typeof COMBUSTIBLE_NIVELES)[number]['value']

export function combustibleLabel(value: number): string {
  return COMBUSTIBLE_NIVELES.find((n) => n.value === value)?.label ?? String(value)
}

export const STORAGE_BUCKET = 'recorridos'
