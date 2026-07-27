-- =========================================================
-- MEJORAS FASE 10: INGRESO EXCEPCIONAL A TALLER
-- CON RECORRIDO ABIERTO
-- =========================================================
-- Ejecutar en el SQL editor de Supabase.
--
-- Problema que resuelve: hasta ahora, "Ingresar a taller"
-- bloqueaba por completo si el vehículo tenía un recorrido
-- abierto (el admin tenía que cerrarlo primero). En la
-- práctica hay casos legítimos donde la unidad entra al
-- taller a media ruta (avería, accidente menor, etc.) y el
-- recorrido no puede/debe cerrarse todavía.
--
-- Esta migración agrega los campos necesarios para permitir
-- esa excepción de forma auditada, sin inventar un
-- kilometraje de ingreso (la unidad está en ruta, su
-- km_actual consolidado no refleja dónde quedó realmente) y
-- sin perder el vínculo con el recorrido que quedó abierto.
-- =========================================================

ALTER TABLE mantenimientos
  ADD COLUMN IF NOT EXISTS ingreso_excepcional BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS motivo_excepcion TEXT,
  ADD COLUMN IF NOT EXISTS autorizado_por VARCHAR(100),
  ADD COLUMN IF NOT EXISTS recorrido_abierto_id UUID REFERENCES recorridos(id);

-- Si es un ingreso excepcional, motivo/autorización/recorrido son obligatorios.
-- km_al_ingreso se deja fuera a propósito: la tabla ya permite NULL ahí
-- (columna sin NOT NULL desde la fase 4), que es justo lo que se debe
-- guardar cuando el kilometraje real de ingreso no se conoce.
ALTER TABLE mantenimientos
  DROP CONSTRAINT IF EXISTS check_ingreso_excepcional_completo;

ALTER TABLE mantenimientos
  ADD CONSTRAINT check_ingreso_excepcional_completo
  CHECK (
    NOT ingreso_excepcional
    OR (
      motivo_excepcion IS NOT NULL AND TRIM(motivo_excepcion) <> ''
      AND autorizado_por IS NOT NULL AND TRIM(autorizado_por) <> ''
      AND recorrido_abierto_id IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_mantenimientos_recorrido_abierto
  ON mantenimientos(recorrido_abierto_id)
  WHERE recorrido_abierto_id IS NOT NULL;

-- Nota: no se agrega ninguna columna nueva a `recorridos` ni a
-- `recorridos_auditoria` — esta migración reutiliza la tabla
-- `recorridos_auditoria` que ya existe (mejoras_fase1_recorridos_admin.sql,
-- columnas accion/realizado_por/comentario/datos_nuevos sin CHECK de
-- valores fijos) para dejar dos eventos en el historial del recorrido:
--   accion = 'suspender_por_mantenimiento'  (al autorizar la excepción)
--   accion = 'reanudar_tras_mantenimiento'  (al cerrar el mantenimiento)
-- El recorrido en sí nunca cambia de estado: sigue 'abierto' todo el
-- tiempo y se cierra después, normalmente, desde /regreso.
