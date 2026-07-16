-- =========================================================
-- MEJORAS FASE 6: MOTIVO DE BAJA/REACTIVACIÓN DE EMPLEADOS
-- =========================================================
-- Ejecutar en el SQL editor de Supabase ANTES de usar el
-- flujo de baja con motivo en /admin/conductores.
--
-- Incluye:
--   1. Tabla conductores_bajas — historial con motivo de
--      cada baja/reactivación de un conductor (empleado)
-- =========================================================

CREATE TABLE IF NOT EXISTS conductores_bajas (
  id SERIAL PRIMARY KEY,
  conductor_id INTEGER NOT NULL REFERENCES conductores(id),
  motivo TEXT NOT NULL,
  tipo VARCHAR(20) NOT NULL DEFAULT 'baja'
    CHECK (tipo IN ('baja', 'reactivacion')),
  fecha TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conductores_bajas_conductor_id
  ON conductores_bajas(conductor_id);

CREATE INDEX IF NOT EXISTS idx_conductores_bajas_fecha
  ON conductores_bajas(fecha);
