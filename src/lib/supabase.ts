import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan variables de entorno: NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

// =========================================================
// TIPOS DEL MODELO DE DATOS
// Refleja exactamente el schema en CLAUDE.md (versión 5)
// =========================================================

// combustible_salida / combustible_regreso: SMALLINT 0-8
// 0=Vacío, 2=1/4, 4=1/2, 6=3/4, 8=Lleno
export type CombustibleNivel = 0 | 2 | 4 | 6 | 8
export type RecorridoEstado = 'abierto' | 'cerrado'
export type VehiculoEstado = 'activo' | 'inactivo'
export type ConductorEstado = 'activo' | 'inactivo'
export type ConductorOrigen = 'catalogo' | 'manual'
export type CentroCostoEstado = 'activo' | 'inactivo'
export type CentroCostoOrigen = 'catalogo' | 'manual'
export type ParadaEstado = 'pendiente' | 'completada'

export interface CentroCosto {
  id: number
  codigo: string
  nombre: string
  estado: CentroCostoEstado
  origen: CentroCostoOrigen
  es_eventual: boolean
  observaciones: string | null
  created_at: string
  updated_at: string
}

export interface Conductor {
  id: number
  nombre: string
  numero_empleado: string | null
  estado: ConductorEstado
  origen: ConductorOrigen
  es_eventual: boolean
  observaciones: string | null
  created_at: string
  updated_at: string
}

export interface Vehiculo {
  codigo: string
  apodo: string | null
  marca: string | null
  modelo: string | null
  anio: number | null
  placa: string | null
  numero_serie: string | null
  capacidad_tanque_litros: number
  km_actual: number
  centro_costo_id: number | null
  estado: VehiculoEstado
  created_at: string
  updated_at: string
}

export interface Recorrido {
  id: string
  vehiculo_codigo: string
  conductor_id: number
  centro_costo_id: number

  usa_paradas: boolean

  fecha_salida: string
  km_salida: number
  combustible_salida: CombustibleNivel
  foto_salida_path: string

  fecha_regreso: string | null
  km_regreso: number | null
  combustible_regreso: CombustibleNivel | null
  foto_regreso_path: string | null

  estado: RecorridoEstado
  created_at: string
  updated_at: string
}

export interface RecorridoParada {
  id: string
  recorrido_id: string
  orden: number
  centro_costo_id: number

  fecha_parada: string | null
  km_parada: number | null
  combustible_parada: CombustibleNivel | null
  foto_parada_path: string | null

  estado: ParadaEstado
  created_at: string
  updated_at: string
}

export interface CargaGasolinaDB {
  id: string
  vehiculo_codigo: string
  conductor_id: number
  recorrido_id: string | null

  km_antes: number
  combustible_antes: number
  foto_tablero_antes_path: string | null

  km_despues: number
  combustible_despues: number
  litros_cargados: number
  precio_litro: number
  foto_tablero_despues_path: string | null
  foto_ticket_path: string | null

  observaciones: string | null
  created_at: string
  updated_at: string
}

// Tipo extendido con joins para mostrar en UI
export interface RecorridoConDetalle extends Recorrido {
  conductores: Pick<Conductor, 'id' | 'nombre'>
  centros_costo: Pick<CentroCosto, 'id' | 'nombre' | 'codigo'>
}

// Parada con join del centro de costo
export interface RecorridoParadaConDetalle extends RecorridoParada {
  centros_costo: Pick<CentroCosto, 'id' | 'nombre' | 'codigo'>
}

export type Database = {
  public: {
    Tables: {
      centros_costo: {
        Row: CentroCosto
        Insert: Omit<CentroCosto, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<CentroCosto, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      conductores: {
        Row: Conductor
        Insert: Omit<Conductor, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Conductor, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      vehiculos: {
        Row: Vehiculo
        Insert: Omit<Vehiculo, 'created_at' | 'updated_at'>
        Update: Partial<Omit<Vehiculo, 'created_at' | 'updated_at'>>
        Relationships: []
      }
      recorridos: {
        Row: Recorrido
        Insert: Omit<Recorrido, 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Omit<Recorrido, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      recorridos_paradas: {
        Row: RecorridoParada
        Insert: Omit<RecorridoParada, 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Omit<RecorridoParada, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      cargas_gasolina: {
        Row: CargaGasolinaDB
        Insert: Omit<CargaGasolinaDB, 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Omit<CargaGasolinaDB, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

// createClient sin generic — los tipos propios (Recorrido, Vehiculo, etc.)
// se usan directamente en el app para tipar los resultados de las queries.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
