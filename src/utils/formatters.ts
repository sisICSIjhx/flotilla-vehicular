import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export function formatFecha(isoString: string): string {
  return format(new Date(isoString), 'dd/MM/yyyy HH:mm', { locale: es })
}

export function formatMoneda(value: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(value)
}

export function formatDecimal(value: number, decimals = 3): string {
  return value.toFixed(decimals)
}
