export function calcKmRecorridos(kmSalida: number, kmRegreso: number): number {
  return kmRegreso - kmSalida
}

export function calcImporte(litros: number, precioLitro: number): number {
  return litros * precioLitro
}

/**
 * Modelo Universal de Rendimiento (Balance de Combustible)
 *
 * litros_consumidos = (C × N_i) + ΣL_r − (C × N_f)
 *
 * @param capacidadTanque  - litros totales del tanque
 * @param combustibleSalida  - nivel al salir (escala 0-8, donde 8=Lleno)
 * @param combustibleRegreso - nivel al regresar (escala 0-8)
 * @param litrosCargados     - suma de recargas durante el viaje (0 si no hubo)
 */
export function calcLitrosConsumidos(
  capacidadTanque: number,
  combustibleSalida: number,
  combustibleRegreso: number,
  litrosCargados: number
): number {
  const Ni = combustibleSalida / 8
  const Nf = combustibleRegreso / 8
  return capacidadTanque * Ni + litrosCargados - capacidadTanque * Nf
}

/**
 * Rendimiento en km/L.
 * Recibe km recorridos y litros CONSUMIDOS (no litros cargados).
 */
export function calcRendimiento(kmRecorridos: number, litrosConsumidos: number): number | null {
  if (!litrosConsumidos || litrosConsumidos <= 0) return null
  return kmRecorridos / litrosConsumidos
}
