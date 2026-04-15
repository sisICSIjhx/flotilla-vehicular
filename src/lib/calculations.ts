export function calcKmRecorridos(kmSalida: number, kmRegreso: number): number {
  return kmRegreso - kmSalida
}

export function calcImporte(litros: number, precioLitro: number): number {
  return litros * precioLitro
}

export function calcRendimiento(kmRecorridos: number, litros: number): number | null {
  if (!litros || litros === 0) return null
  return kmRecorridos / litros
}
