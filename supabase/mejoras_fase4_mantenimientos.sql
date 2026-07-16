-- =========================================================
-- MEJORAS FASE 4: MÓDULO DE MANTENIMIENTOS
-- =========================================================
-- Ejecutar en el SQL editor de Supabase ANTES de usar
-- la sección /admin/mantenimientos.
--
-- Incluye:
--   1. Programa preventivo por vehículo (intervalo en km y
--      km del último mantenimiento como base del próximo)
--   2. Nuevo estado de vehículo: 'mantenimiento' (bloquea salidas)
--   3. Tabla mantenimientos (preventivo/correctivo/otro)
--   4. Regla: solo un mantenimiento "en_taller" por vehículo
-- =========================================================

-- 1. Programa preventivo
ALTER TABLE vehiculos
  ADD COLUMN IF NOT EXISTS intervalo_mantenimiento_km INTEGER,
  ADD COLUMN IF NOT EXISTS km_ultimo_mantenimiento INTEGER;

-- 2. Estado 'mantenimiento'
ALTER TABLE vehiculos
  DROP CONSTRAINT IF EXISTS check_estado_vehiculo;

ALTER TABLE vehiculos
  ADD CONSTRAINT check_estado_vehiculo
  CHECK (estado IN ('activo', 'inactivo', 'mantenimiento'));

-- 3. Tabla de mantenimientos
CREATE TABLE IF NOT EXISTS mantenimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehiculo_codigo VARCHAR(20) NOT NULL REFERENCES vehiculos(codigo),
  tipo VARCHAR(20) NOT NULL DEFAULT 'preventivo',
  estado VARCHAR(20) NOT NULL DEFAULT 'en_taller',
  descripcion TEXT NOT NULL,
  lugar VARCHAR(150),                    -- taller donde se atiende
  km_al_ingreso INTEGER,                 -- km al dejar la unidad
  fecha_ingreso TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  fecha_salida TIMESTAMP WITH TIME ZONE, -- para calcular tiempo en taller
  costo DECIMAL(12,2),
  factura_path TEXT,                     -- evidencia (foto de factura/nota)
  observaciones TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT check_tipo_mantenimiento
    CHECK (tipo IN ('preventivo', 'correctivo', 'otro')),

  CONSTRAINT check_estado_mantenimiento
    CHECK (estado IN ('programado', 'en_taller', 'completado')),

  CONSTRAINT check_costo_mantenimiento
    CHECK (costo IS NULL OR costo >= 0),

  CONSTRAINT check_km_al_ingreso
    CHECK (km_al_ingreso IS NULL OR km_al_ingreso >= 0),

  CONSTRAINT check_fechas_mantenimiento
    CHECK (fecha_salida IS NULL OR fecha_salida >= fecha_ingreso)
);

CREATE INDEX IF NOT EXISTS idx_mantenimientos_vehiculo
  ON mantenimientos(vehiculo_codigo);

CREATE INDEX IF NOT EXISTS idx_mantenimientos_estado
  ON mantenimientos(estado);

CREATE INDEX IF NOT EXISTS idx_mantenimientos_fecha_ingreso
  ON mantenimientos(fecha_ingreso);

-- 4. Solo un mantenimiento en taller por vehículo
CREATE UNIQUE INDEX IF NOT EXISTS ux_mantenimiento_en_taller_por_vehiculo
  ON mantenimientos(vehiculo_codigo)
  WHERE estado = 'en_taller';

DROP TRIGGER IF EXISTS trg_mantenimientos_updated_at ON mantenimientos;
CREATE TRIGGER trg_mantenimientos_updated_at
BEFORE UPDATE ON mantenimientos
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Este proyecto no usa RLS en el MVP (ver CLAUDE.md). Si Supabase la
-- activa por defecto al crear la tabla desde el dashboard, el frontend
-- (MantenimientosAdminView.tsx) no podrá leer ni escribir mantenimientos.
ALTER TABLE mantenimientos DISABLE ROW LEVEL SECURITY;
