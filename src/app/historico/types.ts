// Tipos compartidos entre la vista de Histórico y la exportación

export interface Parada {
  id: string
  orden: number
  estado: string
  fecha_parada?: string | null
  km_parada: number | null
  combustible_parada: number | null
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
  foto_salida_path: string | null
  foto_regreso_path: string | null
  conductores: { nombre: string } | null
  centros_costo: { nombre: string } | null
  vehiculos: { capacidad_tanque_litros: number; placa: string | null; apodo: string | null } | null
  recorridos_paradas: Parada[]
}

/** Mapa con totales de combustible por recorrido_id, obtenidos de cargas_gasolina */
export type FuelMap = Map<string, { litros: number; costo: number }>

/** CargaGasolina desde la tabla cargas_gasolina (con JOINs normalizados para UI) */
export interface CargaGasolina {
  id: string
  vehiculo_codigo: string
  placa: string | null
  apodo: string | null
  modelo: string | null
  conductor: string
  recorrido_id: string | null
  destino: string | null
  km_antes: number
  km_despues: number
  combustible_antes: number
  combustible_despues: number
  litros_cargados: number
  precio_litro: number
  costo_total: number
  foto_tablero_antes_path: string | null
  foto_tablero_despues_path: string | null
  foto_ticket_path: string | null
  observaciones: string | null
  fecha_carga: string
  fecha_siguiente_carga: string | null
  km_siguiente_carga: number | null
}

export type VistaActiva = 'recorridos' | 'cargas'
export type TipoCarga = 'todas' | 'en_recorrido' | 'fuera_recorrido'
