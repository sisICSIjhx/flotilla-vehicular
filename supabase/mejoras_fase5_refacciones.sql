-- =========================================================
-- MEJORAS FASE 5: MÓDULO DE REFACCIONES
-- =========================================================
-- Ejecutar en el SQL editor de Supabase DESPUÉS de la fase 4
-- (la FK opcional apunta a mantenimientos).
-- =========================================================

CREATE TABLE IF NOT EXISTS refacciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehiculo_codigo VARCHAR(20) NOT NULL REFERENCES vehiculos(codigo),
  mantenimiento_id UUID REFERENCES mantenimientos(id) ON DELETE SET NULL,
  nombre VARCHAR(150) NOT NULL,
  motivo TEXT NOT NULL,                  -- por qué se compró
  costo DECIMAL(12,2) NOT NULL,
  proveedor VARCHAR(150),
  fecha_compra DATE NOT NULL DEFAULT CURRENT_DATE,
  km_al_momento INTEGER,
  factura_path TEXT,
  observaciones TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT check_costo_refaccion
    CHECK (costo >= 0),

  CONSTRAINT check_km_refaccion
    CHECK (km_al_momento IS NULL OR km_al_momento >= 0)
);

CREATE INDEX IF NOT EXISTS idx_refacciones_vehiculo
  ON refacciones(vehiculo_codigo);

CREATE INDEX IF NOT EXISTS idx_refacciones_mantenimiento
  ON refacciones(mantenimiento_id);

CREATE INDEX IF NOT EXISTS idx_refacciones_fecha
  ON refacciones(fecha_compra);

DROP TRIGGER IF EXISTS trg_refacciones_updated_at ON refacciones;
CREATE TRIGGER trg_refacciones_updated_at
BEFORE UPDATE ON refacciones
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Este proyecto no usa RLS en el MVP (ver CLAUDE.md). Si Supabase la
-- activa por defecto al crear la tabla desde el dashboard, el frontend
-- (MantenimientosAdminView.tsx, tab Refacciones) no podrá leer ni escribir.
ALTER TABLE refacciones DISABLE ROW LEVEL SECURITY;
