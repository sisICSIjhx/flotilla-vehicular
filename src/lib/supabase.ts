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
// 'mantenimiento' requiere la migración mejoras_fase4_mantenimientos.sql
export type VehiculoEstado = 'activo' | 'inactivo' | 'mantenimiento'
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

// ── Bajas de empleados ─────────────────────────────────
// (migración mejoras_fase6_empleados_bajas.sql)
export type ConductorBajaTipo = 'baja' | 'reactivacion'

export interface ConductorBaja {
  id: number
  conductor_id: number
  motivo: string
  tipo: ConductorBajaTipo
  fecha: string
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

  // ── Resguardo (migración mejoras_fase3_resguardo.sql) ──
  ubicacion_default?: string | null
  conductor_designado_id?: number | null

  // ── Programa preventivo (migración mejoras_fase4_mantenimientos.sql) ──
  intervalo_mantenimiento_km?: number | null
  km_ultimo_mantenimiento?: number | null
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
  // 'admin' = capturada retroactivamente desde /admin/recorridos
  // (migración mejoras_fase1_recorridos_admin.sql)
  origen?: 'operativo' | 'admin'
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

  combustible_despues: number
  litros_cargados: number
  precio_litro: number
  foto_tablero_despues_path: string | null
  foto_ticket_path: string | null

  observaciones: string | null
  created_at: string
  updated_at: string
}

// ── Solicitudes de combustible ─────────────────────────
export type SolicitudEstado =
  | 'pendiente'
  | 'autorizada'
  | 'rechazada'
  | 'cancelada'
  | 'cargada_edenred'

export type TipoCargaCombustible =
  | 'operacion_campo'
  | 'actividades_administrativas'
  | 'atencion_usuario'
  | 'clientes_potenciales'
  | 'proyecto_alex'
  | 'prestamo_personal'
  | 'viaje_foraneo'
  | 'emergencia_operativa'

export interface SolicitudCombustible {
  id: string
  folio: string | null
  recorrido_id: string | null
  vehiculo_codigo: string
  conductor_id: number
  centro_costo_id: number | null

  placa: string | null
  solicitado_por: string | null
  destino: string | null

  km_solicitud: number
  combustible_nivel: number
  tipo_carga: TipoCargaCombustible
  monto_solicitado: number
  monto_sugerido: number | null
  observaciones: string | null

  fuera_horario: boolean
  emergencia: boolean

  estado: SolicitudEstado
  motivo_rechazo: string | null
  fecha_autorizacion: string | null
  autorizado_por: string | null
  monto_autorizado: number | null
  fecha_carga_edenred: string | null
  cargado_por: string | null
  edenred_evidencia_path: string | null

  eliminado: boolean

  created_at: string
  updated_at: string
}

export interface SolicitudCombustibleAuditoria {
  id: string
  solicitud_id: string
  accion: string
  estado_anterior: string | null
  estado_nuevo: string | null
  usuario: string | null
  comentario: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

// ── Auditoría de ediciones admin sobre recorridos ──────
// (migración mejoras_fase1_recorridos_admin.sql)
export interface RecorridoAuditoria {
  id: string
  recorrido_id: string
  accion: string
  datos_anteriores: Record<string, unknown> | null
  datos_nuevos: Record<string, unknown> | null
  realizado_por: string | null
  comentario: string | null
  created_at: string
}

// ── Mantenimientos ─────────────────────────────────────
// (migración mejoras_fase4_mantenimientos.sql)
export type MantenimientoTipo = 'preventivo' | 'correctivo' | 'otro'
export type MantenimientoEstado = 'programado' | 'en_taller' | 'completado'

export interface Mantenimiento {
  id: string
  vehiculo_codigo: string
  tipo: MantenimientoTipo
  estado: MantenimientoEstado
  descripcion: string
  lugar: string | null
  km_al_ingreso: number | null
  fecha_ingreso: string
  fecha_salida: string | null
  costo: number | null
  factura_path: string | null
  observaciones: string | null
  // Soft delete admin (mejoras_fase9_bucket_auditoria_admin.sql)
  eliminado?: boolean
  // Ingreso excepcional con recorrido abierto (mejoras_fase10_ingreso_excepcional.sql):
  // el vehículo entró a taller sin cerrar su recorrido en curso.
  ingreso_excepcional?: boolean
  motivo_excepcion?: string | null
  autorizado_por?: string | null
  recorrido_abierto_id?: string | null
  created_at: string
  updated_at: string
}

// ── Refacciones y otros gastos ─────────────────────────
// (migración mejoras_fase5_refacciones.sql;
//  categoria llega con mejoras_fase8_mantenimientos_v2.sql)
export interface Refaccion {
  id: string
  vehiculo_codigo: string
  mantenimiento_id: string | null
  nombre: string
  motivo: string
  costo: number
  proveedor: string | null
  fecha_compra: string
  km_al_momento: number | null
  factura_path: string | null
  observaciones: string | null
  categoria?: 'refaccion' | 'gasto'
  // Soft delete admin (mejoras_fase9_bucket_auditoria_admin.sql)
  eliminado?: boolean
  created_at: string
  updated_at: string
}

// ── Auditoría administrativa unificada ─────────────────
// (migración mejoras_fase9_bucket_auditoria_admin.sql)
export interface AuditoriaAdmin {
  id: string
  modulo: 'mantenimiento' | 'refaccion' | 'gasto' | string
  registro_id: string
  vehiculo_codigo: string | null
  accion: 'edicion_admin' | 'eliminacion_admin' | string
  motivo: string
  antes: Record<string, unknown> | null
  despues: Record<string, unknown> | null
  created_at: string
}

export interface Notificacion {
  id: string
  tipo: string
  destinatario: 'admin' | 'operador'
  titulo: string
  mensaje: string | null
  solicitud_id: string | null
  vehiculo_codigo: string | null
  leida: boolean
  created_at: string
}

// Solicitud con joins para la vista administrativa
export interface SolicitudCombustibleConDetalle extends SolicitudCombustible {
  conductores: Pick<Conductor, 'id' | 'nombre'>
  centros_costo: Pick<CentroCosto, 'id' | 'nombre' | 'codigo'> | null
  vehiculos: Pick<Vehiculo, 'codigo' | 'apodo' | 'placa'>
}

// Entrada de auditoría con la solicitud embebida, para la pantalla
// /solicitudes/historial (ediciones y eliminaciones administrativas)
export interface SolicitudCombustibleAuditoriaConDetalle extends SolicitudCombustibleAuditoria {
  solicitudes_combustible: {
    folio: string | null
    vehiculo_codigo: string
    estado: SolicitudEstado
    monto_solicitado: number
    monto_autorizado: number | null
    vehiculos: Pick<Vehiculo, 'apodo' | 'placa'>
    conductores: Pick<Conductor, 'nombre'>
    centros_costo: Pick<CentroCosto, 'nombre'> | null
  } | null
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
      solicitudes_combustible: {
        Row: SolicitudCombustible
        Insert: Omit<
          SolicitudCombustible,
          | 'id'
          | 'folio'
          | 'estado'
          | 'motivo_rechazo'
          | 'fecha_autorizacion'
          | 'autorizado_por'
          | 'monto_autorizado'
          | 'fecha_carga_edenred'
          | 'cargado_por'
          | 'edenred_evidencia_path'
          | 'eliminado'
          | 'created_at'
          | 'updated_at'
        > & { id?: string }
        Update: never // las transiciones de estado y edición/eliminación solo pasan por RPCs
        Relationships: []
      }
      solicitudes_combustible_auditoria: {
        Row: SolicitudCombustibleAuditoria
        Insert: never // solo escriben los triggers/RPCs en BD
        Update: never
        Relationships: []
      }
      notificaciones: {
        Row: Notificacion
        Insert: never // las crean los triggers en BD
        Update: { leida: boolean }
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
