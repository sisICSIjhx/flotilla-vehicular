-- =========================================================
-- MEJORAS FASE 9: BUCKET "mantenimientos" + EDICIÓN ADMIN
--                 + AUDITORÍA ADMINISTRATIVA UNIFICADA
-- =========================================================
-- Ejecutar en el SQL editor de Supabase DESPUÉS de la fase 8
-- (mejoras_fase8_mantenimientos_v2.sql).
--
-- Incluye:
--   1. Políticas del bucket "mantenimientos" (ya creado desde el
--      dashboard): ahí viven las fotos de facturas de mantenimientos,
--      refacciones y otros gastos (separadas del bucket "recorridos")
--   2. Soft delete (columna eliminado) en mantenimientos y refacciones
--   3. Tabla auditoria_admin: bitácora ÚNICA para ediciones y
--      eliminaciones administrativas de mantenimientos, refacciones y
--      otros gastos. El historial unificado de /admin/historial lee
--      esta tabla y además une las bitácoras ya existentes
--      (solicitudes_combustible_auditoria y recorridos_auditoria).
-- =========================================================

-- =========================================================
-- 1. STORAGE: bucket "mantenimientos"
--    (idempotente: si ya lo creaste en el dashboard, solo
--     asegura que sea público y agrega las políticas)
-- =========================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('mantenimientos', 'mantenimientos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Upload anónimo facturas mantenimientos'
  ) THEN
    CREATE POLICY "Upload anónimo facturas mantenimientos"
      ON storage.objects FOR INSERT
      TO anon, authenticated
      WITH CHECK (bucket_id = 'mantenimientos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Lectura pública facturas mantenimientos'
  ) THEN
    CREATE POLICY "Lectura pública facturas mantenimientos"
      ON storage.objects FOR SELECT
      TO anon, authenticated
      USING (bucket_id = 'mantenimientos');
  END IF;
END;
$$;

-- =========================================================
-- 2. SOFT DELETE ADMIN
--    Las eliminaciones no borran la fila: se marca eliminado
--    y el motivo queda en auditoria_admin.
-- =========================================================
ALTER TABLE mantenimientos
  ADD COLUMN IF NOT EXISTS eliminado BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE refacciones
  ADD COLUMN IF NOT EXISTS eliminado BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_mantenimientos_eliminado
  ON mantenimientos(eliminado);

CREATE INDEX IF NOT EXISTS idx_refacciones_eliminado
  ON refacciones(eliminado);

-- =========================================================
-- 3. AUDITORÍA ADMINISTRATIVA UNIFICADA
-- =========================================================
-- Una sola bitácora para los módulos nuevos. Los módulos con
-- bitácora propia (solicitudes, recorridos) se quedan como están;
-- el frontend concentra todo en /admin/historial.
CREATE TABLE IF NOT EXISTS auditoria_admin (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo VARCHAR(30) NOT NULL,        -- mantenimiento | refaccion | gasto (extensible)
  registro_id TEXT NOT NULL,          -- id del registro afectado
  vehiculo_codigo VARCHAR(20),
  accion VARCHAR(30) NOT NULL,        -- edicion_admin | eliminacion_admin
  motivo TEXT NOT NULL,
  antes JSONB,                        -- solo los campos que cambiaron
  despues JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT check_accion_auditoria_admin
    CHECK (accion IN ('edicion_admin', 'eliminacion_admin')),

  CONSTRAINT check_motivo_auditoria_admin
    CHECK (LENGTH(TRIM(motivo)) > 0)
);

COMMENT ON TABLE auditoria_admin IS
  'Bitácora unificada de cambios administrativos (mantenimientos, refacciones, gastos). Se muestra junto con solicitudes_combustible_auditoria y recorridos_auditoria en /admin/historial.';

CREATE INDEX IF NOT EXISTS idx_auditoria_admin_modulo
  ON auditoria_admin(modulo);

CREATE INDEX IF NOT EXISTS idx_auditoria_admin_vehiculo
  ON auditoria_admin(vehiculo_codigo);

CREATE INDEX IF NOT EXISTS idx_auditoria_admin_created
  ON auditoria_admin(created_at DESC);

-- Este proyecto no usa RLS en el MVP (ver CLAUDE.md): el frontend
-- inserta y lee esta bitácora directamente.
ALTER TABLE auditoria_admin DISABLE ROW LEVEL SECURITY;
