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

// ── Historial de cambios administrativos sobre solicitudes ─
// (migración mejoras_fase7_solicitudes_edicion_admin.sql)
export const HISTORIAL_SOLICITUD_TIPOS: Record<
  string,
  { label: string; badge: string; rowBg: string }
> = {
  edicion_admin: {
    label: 'Editado',
    badge: 'bg-orange-100 text-orange-700 border-orange-200',
    rowBg: 'bg-orange-50 border-orange-200',
  },
  eliminacion_admin: {
    label: 'Eliminado',
    badge: 'bg-red-100 text-red-700 border-red-200',
    rowBg: 'bg-red-50 border-red-200',
  },
}

export function historialSolicitudTipoLabel(accion: string): string {
  return HISTORIAL_SOLICITUD_TIPOS[accion]?.label ?? accion
}

// Campos de admin editables en una solicitud (nunca los del conductor)
export const CAMPOS_EDITABLES_SOLICITUD_LABEL: Record<string, string> = {
  monto_autorizado: 'Monto autorizado',
  motivo_rechazo: 'Motivo de rechazo',
  autorizado_por: 'Autorizado / resuelto por',
  cargado_por: 'Cargado por (Edenred)',
}

// Umbral de justificación: monto solicitado > sugerido * 1.30
export const SOLICITUD_UMBRAL_SOBREMONTO = 1.3
// Hora local a partir de la cual una solicitud se marca fuera de horario
export const SOLICITUD_HORA_LIMITE = 20

// ── Mantenimientos ─────────────────────────────────────────
export const MANTENIMIENTO_TIPOS = [
  { value: 'preventivo', label: 'Preventivo' },
  { value: 'correctivo', label: 'Correctivo' },
  { value: 'otro', label: 'Otro' },
] as const

export function mantenimientoTipoLabel(value: string): string {
  return MANTENIMIENTO_TIPOS.find((t) => t.value === value)?.label ?? value
}

export const MANTENIMIENTO_ESTADOS: Record<string, { label: string; badge: string }> = {
  programado: { label: 'Programado', badge: 'bg-blue-100 text-blue-800 border-blue-200' },
  en_taller: { label: 'En taller', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  completado: { label: 'Completado', badge: 'bg-green-100 text-green-800 border-green-200' },
}

// Pre-alerta de mantenimiento preventivo: cuántos km antes
// del umbral se empieza a avisar "próximo a vencer"
export const MANTENIMIENTO_PREALERTA_KM = 500
// Ventana (días) para estimar el km diario promedio de una unidad
export const MANTENIMIENTO_VENTANA_KM_DIARIO_DIAS = 30
