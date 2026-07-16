-- =========================================================
-- MEJORAS FASE 3: RESGUARDO DE VEHÍCULOS
-- =========================================================
-- Ejecutar en el SQL editor de Supabase.
--
--   - ubicacion_default: base/patio donde vive la unidad
--   - conductor_designado_id: conductor que tiene la unidad
--     a su resguardo (se preselecciona en el form de salida)
-- =========================================================

ALTER TABLE vehiculos
  ADD COLUMN IF NOT EXISTS ubicacion_default VARCHAR(150),
  ADD COLUMN IF NOT EXISTS conductor_designado_id INTEGER REFERENCES conductores(id);

CREATE INDEX IF NOT EXISTS idx_vehiculos_conductor_designado
  ON vehiculos(conductor_designado_id);
