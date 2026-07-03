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

// ── Solicitudes de combustible ─────────────────────────────
export const TIPOS_CARGA = [
  { value: 'operacion_campo', label: 'Operación en campo' },
  { value: 'actividades_administrativas', label: 'Actividades administrativas' },
  { value: 'atencion_usuario', label: 'Atención a usuario' },
  { value: 'clientes_potenciales', label: 'Clientes potenciales' },
  { value: 'proyecto_alex', label: 'Proyecto Alex' },
  { value: 'prestamo_personal', label: 'Préstamo personal' },
  { value: 'viaje_foraneo', label: 'Viaje foráneo' },
  { value: 'emergencia_operativa', label: 'Emergencia operativa' },
] as const

export function tipoCargaLabel(value: string): string {
  return TIPOS_CARGA.find((t) => t.value === value)?.label ?? value
}

export const SOLICITUD_ESTADOS: Record<
  string,
  { label: string; badge: string }
> = {
  pendiente: { label: 'Pendiente', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  autorizada: { label: 'Autorizada', badge: 'bg-blue-100 text-blue-800 border-blue-200' },
  rechazada: { label: 'Rechazada', badge: 'bg-red-100 text-red-700 border-red-200' },
  cancelada: { label: 'Cancelada', badge: 'bg-gray-100 text-gray-600 border-gray-200' },
  cargada_edenred: { label: 'Cargada en Edenred', badge: 'bg-green-100 text-green-800 border-green-200' },
}

export function solicitudEstadoLabel(estado: string): string {
  return SOLICITUD_ESTADOS[estado]?.label ?? estado
}

// Umbral de justificación: monto solicitado > sugerido * 1.30
export const SOLICITUD_UMBRAL_SOBREMONTO = 1.3
// Hora local a partir de la cual una solicitud se marca fuera de horario
export const SOLICITUD_HORA_LIMITE = 20
