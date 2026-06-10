// Tipos compartidos entre la vista de Histórico y la exportación

export interface Parada {
  id: string
  orden: number
  estado: string
  fecha_parada?: string | null
  km_parada: number | null
  combustible_parada: number | null
  litros_cargados: number | null
  precio_litro: number | null
  foto_parada_path: string | null
  centros_costo: { nombre: string } | null
}

export interface RecorridoHistorico {
  id: string
  vehiculo_codigo: string
  estado: string
  usa_paradas: boolean
  fecha_salida: string
  fecha_regreso: string | null
  km_salida: number
  km_regreso: number | null
  combustible_salida: number
  combustible_regreso: number | null
  litros_cargados: number | null
  precio_litro: number | null
  foto_salida_path: string | null
  foto_regreso_path: string | null
  conductores: { nombre: string } | null
  centros_costo: { nombre: string } | null
  vehiculos: { capacidad_tanque_litros: number; placa: string | null; apodo: string | null } | null
  recorridos_paradas: Parada[]
}

export interface CargaGasolina {
  recorrido_id: string
  parada_id: string | null
  tipo_carga: 'regreso_final' | 'parada_intermedia'
  vehiculo_codigo: string
  placa: string | null
  modelo: string | null
  conductor: string
  fecha_carga: string
  km_carga: number
  litros_cargados: number
  precio_litro: number
  costo_total: number
  fecha_siguiente_carga: string | null
  km_siguiente_carga: number | null
}

export type Periodo = 'todo' | 'semana' | 'mes' | 'mes_anterior'
export type VistaActiva = 'recorridos' | 'cargas'
export type TipoCarga = 'todas' | 'regreso_final' | 'parada_intermedia'

export const PERIODOS: { value: Periodo; label: string }[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'semana', label: 'Esta semana' },
  { value: 'mes', label: 'Este mes' },
  { value: 'mes_anterior', label: 'Mes anterior' },
]

export function periodoLabel(periodo: Periodo): string {
  return PERIODOS.find((p) => p.value === periodo)?.label ?? periodo
}
