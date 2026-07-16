-- =========================================================
-- MEJORAS FASE 1: EDICIÓN ADMINISTRATIVA DE RECORRIDOS
-- =========================================================
-- Ejecutar en el SQL editor de Supabase ANTES de usar
-- la nueva sección /admin/recorridos.
--
-- Incluye:
--   1. Columna origen en recorridos_paradas (operativo | admin)
--   2. CHECK relajado: paradas capturadas por admin no exigen foto
--   3. Tabla recorridos_auditoria (bitácora de cambios admin)
--   4. Ajuste de validar_km_recorrido: la validación contra
--      vehiculos.km_actual solo aplica en INSERT (si no, sería
--      imposible editar recorridos históricos, cuyo km_salida
--      siempre es menor al km_actual consolidado)
--   5. Función recalcular_km_actual para corregir el km del
--      vehículo cuando el admin edita kilometrajes a la baja
-- =========================================================

-- 1. Columna origen en recorridos_paradas
ALTER TABLE recorridos_paradas
  ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'operativo';

ALTER TABLE recorridos_paradas
  DROP CONSTRAINT IF EXISTS check_origen_parada;

ALTER TABLE recorridos_paradas
  ADD CONSTRAINT check_origen_parada
  CHECK (origen IN ('operativo', 'admin'));

-- 2. Relajar el CHECK: la foto solo es obligatoria en capturas operativas.
--    Las paradas retroactivas capturadas por el administrador pueden
--    quedar sin evidencia fotográfica.
ALTER TABLE recorridos_paradas
  DROP CONSTRAINT IF EXISTS check_parada_completada_con_datos;

ALTER TABLE recorridos_paradas
  ADD CONSTRAINT check_parada_completada_con_datos
  CHECK (
    estado = 'pendiente'
    OR (
      estado = 'completada'
      AND fecha_parada IS NOT NULL
      AND km_parada IS NOT NULL
      AND combustible_parada IS NOT NULL
      AND (foto_parada_path IS NOT NULL OR origen = 'admin')
    )
  );

-- 3. Bitácora de cambios administrativos sobre recorridos
CREATE TABLE IF NOT EXISTS recorridos_auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorrido_id UUID NOT NULL REFERENCES recorridos(id) ON DELETE CASCADE,
  accion VARCHAR(50) NOT NULL,          -- 'editar_recorrido', 'agregar_parada', 'editar_parada', 'eliminar_parada', 'reabrir', 'cerrar'
  datos_anteriores JSONB,
  datos_nuevos JSONB,
  realizado_por VARCHAR(100),
  comentario TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recorridos_auditoria_recorrido
  ON recorridos_auditoria(recorrido_id);

CREATE INDEX IF NOT EXISTS idx_recorridos_auditoria_created
  ON recorridos_auditoria(created_at);

-- Este proyecto no usa RLS en el MVP (ver CLAUDE.md). Si Supabase la
-- activa por defecto al crear la tabla desde el dashboard, el frontend
-- (RecorridosAdminView.tsx) no podrá insertar el log de auditoría.
ALTER TABLE recorridos_auditoria DISABLE ROW LEVEL SECURITY;

-- 4. validar_km_recorrido: validar contra km_actual SOLO en INSERT.
--    En UPDATE se conserva la validación interna km_regreso >= km_salida.
CREATE OR REPLACE FUNCTION validar_km_recorrido()
RETURNS TRIGGER AS $$
DECLARE
  v_km_actual INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT km_actual
    INTO v_km_actual
    FROM vehiculos
    WHERE codigo = NEW.vehiculo_codigo;

    IF v_km_actual IS NULL THEN
      RAISE EXCEPTION 'No existe kilometraje base para el vehículo %', NEW.vehiculo_codigo;
    END IF;

    IF NEW.km_salida < v_km_actual THEN
      RAISE EXCEPTION
        'El km_salida (%) no puede ser menor al km_actual del vehículo (%)',
        NEW.km_salida, v_km_actual;
    END IF;
  END IF;

  IF NEW.km_regreso IS NOT NULL AND NEW.km_regreso < NEW.km_salida THEN
    RAISE EXCEPTION
      'El km_regreso (%) no puede ser menor al km_salida (%)',
      NEW.km_regreso, NEW.km_salida;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Recalcular km_actual desde los datos reales
--    (recorridos, paradas y cargas). Útil cuando el admin corrige
--    un kilometraje a la baja: el trigger de sincronización solo
--    hace GREATEST y nunca revierte.
CREATE OR REPLACE FUNCTION recalcular_km_actual(p_vehiculo_codigo TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_max INTEGER;
BEGIN
  SELECT GREATEST(
    COALESCE((
      SELECT MAX(GREATEST(r.km_salida, COALESCE(r.km_regreso, 0)))
      FROM recorridos r
      WHERE r.vehiculo_codigo = p_vehiculo_codigo
    ), 0),
    COALESCE((
      SELECT MAX(rp.km_parada)
      FROM recorridos_paradas rp
      JOIN recorridos r ON r.id = rp.recorrido_id
      WHERE r.vehiculo_codigo = p_vehiculo_codigo
        AND rp.km_parada IS NOT NULL
    ), 0)
  )
  INTO v_max;

  -- Si no hay datos de recorridos, conservar el km_actual manual
  IF v_max > 0 THEN
    UPDATE vehiculos
    SET km_actual = v_max
    WHERE codigo = p_vehiculo_codigo;
  END IF;

  RETURN v_max;
END;
$$ LANGUAGE plpgsql;
