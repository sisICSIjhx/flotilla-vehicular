-- =========================================================
-- MODULO SOLICITUD DE COMBUSTIBLE — AJUSTES V2
-- Script idempotente para el SQL Editor de Supabase.
-- Requiere haber ejecutado antes supabase_fuel_requests.sql.
--
-- Cambios:
--   1. La solicitud ya NO requiere recorrido activo:
--      recorrido_id y centro_costo_id pasan a ser opcionales.
--      Si hay recorrido abierto, la app lo vincula automáticamente.
--   2. El trigger de validación solo valida recorrido/kilometraje
--      cuando la solicitud viene vinculada a un recorrido.
--   3. La vista de reportes usa LEFT JOIN (centro de costo opcional).
-- (La evidencia Edenred ya era opcional en BD; el cambio es solo
--  de frontend.)
-- =========================================================

-- 1. Columnas opcionales (ALTER ... DROP NOT NULL es idempotente)
ALTER TABLE solicitudes_combustible ALTER COLUMN recorrido_id DROP NOT NULL;
ALTER TABLE solicitudes_combustible ALTER COLUMN centro_costo_id DROP NOT NULL;

COMMENT ON COLUMN solicitudes_combustible.recorrido_id IS
  'Recorrido abierto al momento de solicitar, si existía. NULL si la solicitud se hizo sin recorrido activo.';

-- 2. Validación: solo aplica si la solicitud viene con recorrido
CREATE OR REPLACE FUNCTION validar_solicitud_combustible()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recorrido RECORD;
BEGIN
  -- Sin recorrido vinculado: aplican solo los constraints base
  IF NEW.recorrido_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT r.estado, r.km_salida, r.vehiculo_codigo
  INTO v_recorrido
  FROM recorridos r
  WHERE r.id = NEW.recorrido_id;

  IF v_recorrido IS NULL THEN
    RAISE EXCEPTION 'El recorrido indicado no existe';
  END IF;

  IF v_recorrido.estado <> 'abierto' THEN
    RAISE EXCEPTION 'El recorrido vinculado ya no está abierto.';
  END IF;

  IF v_recorrido.vehiculo_codigo <> NEW.vehiculo_codigo THEN
    RAISE EXCEPTION 'El recorrido no corresponde al vehículo %', NEW.vehiculo_codigo;
  END IF;

  IF NEW.km_solicitud < v_recorrido.km_salida THEN
    RAISE EXCEPTION
      'El kilometraje (%) no puede ser menor al km de salida del recorrido (%)',
      NEW.km_solicitud, v_recorrido.km_salida;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Vista de reportes con joins opcionales
CREATE OR REPLACE VIEW v_solicitudes_combustible_resumen
WITH (security_invoker = true) AS
SELECT
  sc.id,
  sc.folio,
  sc.created_at,
  sc.estado,
  sc.vehiculo_codigo,
  COALESCE(sc.placa, v.placa) AS placa,
  v.apodo,
  c.nombre AS operador,
  cc.nombre AS centro_costo,
  sc.destino,
  sc.km_solicitud,
  sc.combustible_nivel,
  sc.tipo_carga,
  sc.monto_solicitado,
  sc.monto_sugerido,
  sc.monto_autorizado,
  sc.fuera_horario,
  sc.emergencia,
  sc.fecha_autorizacion,
  sc.autorizado_por,
  sc.fecha_carga_edenred,
  sc.cargado_por,
  sc.motivo_rechazo,
  sc.observaciones,
  sc.edenred_evidencia_path
FROM solicitudes_combustible sc
JOIN vehiculos v ON v.codigo = sc.vehiculo_codigo
JOIN conductores c ON c.id = sc.conductor_id
LEFT JOIN centros_costo cc ON cc.id = sc.centro_costo_id;
