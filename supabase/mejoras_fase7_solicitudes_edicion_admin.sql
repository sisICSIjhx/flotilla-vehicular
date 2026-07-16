-- =========================================================
-- MEJORAS FASE 7: EDICIÓN Y ELIMINACIÓN (SOFT DELETE)
-- ADMINISTRATIVA DE SOLICITUDES DE COMBUSTIBLE
-- =========================================================
-- Ejecutar en el SQL editor de Supabase DESPUÉS de
-- supabase_fuel_requests.sql y supabase_fuel_requests_v2.sql.
-- Script idempotente, no borra ni modifica datos existentes.
--
-- Incluye:
--   1. Columna eliminado en solicitudes_combustible (soft delete)
--   2. RPC editar_solicitud_combustible_admin: corrige SOLO los
--      campos capturados por el admin (monto_autorizado,
--      motivo_rechazo, autorizado_por, cargado_por). Nunca toca
--      los campos capturados por el conductor. Motivo obligatorio.
--   3. RPC eliminar_solicitud_combustible_admin: soft delete con
--      motivo obligatorio. No borra el registro, solo lo marca.
--   4. Ambas quedan registradas en solicitudes_combustible_auditoria
--      (accion = 'edicion_admin' | 'eliminacion_admin'), la misma
--      bitácora que ya usan autorizar/rechazar/cancelar/carga.
--   5. v_solicitudes_combustible_resumen expone la columna eliminado.
-- =========================================================

-- =========================================================
-- 1. COLUMNA SOFT-DELETE
-- =========================================================
ALTER TABLE solicitudes_combustible
  ADD COLUMN IF NOT EXISTS eliminado BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN solicitudes_combustible.eliminado IS
  'Soft delete administrativo. TRUE = eliminada por un admin (con motivo obligatorio en solicitudes_combustible_auditoria). No se borra el registro para conservar el historial.';

CREATE INDEX IF NOT EXISTS idx_solicitudes_comb_eliminado
  ON solicitudes_combustible(eliminado);

CREATE INDEX IF NOT EXISTS idx_solicitudes_comb_auditoria_accion
  ON solicitudes_combustible_auditoria(accion);

-- =========================================================
-- 2. RPC: EDITAR CAMPOS DE ADMIN (monto, rechazo, responsables)
-- =========================================================
-- Cada parámetro NULL significa "no cambiar este campo". Solo se
-- exponen los campos que llena el admin; los datos capturados por
-- el conductor (km, nivel, tipo_carga, monto_solicitado,
-- observaciones, destino, etc.) no son parámetros de esta función
-- y por lo tanto no se pueden editar desde aquí.
CREATE OR REPLACE FUNCTION editar_solicitud_combustible_admin(
  p_solicitud_id UUID,
  p_usuario TEXT,
  p_motivo TEXT,
  p_monto_autorizado NUMERIC DEFAULT NULL,
  p_motivo_rechazo TEXT DEFAULT NULL,
  p_autorizado_por TEXT DEFAULT NULL,
  p_cargado_por TEXT DEFAULT NULL
)
RETURNS solicitudes_combustible
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sol solicitudes_combustible%ROWTYPE;
  v_antes JSONB;
  v_despues JSONB;
  -- Normalizados una sola vez: NULL = "no tocar este campo". Un
  -- parámetro de texto vacío/solo-espacios se trata igual que NULL
  -- (no borra el campo, esta función no soporta vaciar campos).
  v_motivo_rechazo_nuevo TEXT := NULLIF(TRIM(p_motivo_rechazo), '');
  v_autorizado_por_nuevo TEXT := NULLIF(TRIM(p_autorizado_por), '');
  v_cargado_por_nuevo TEXT := NULLIF(TRIM(p_cargado_por), '');
BEGIN
  IF p_usuario IS NULL OR LENGTH(TRIM(p_usuario)) = 0 THEN
    RAISE EXCEPTION 'Debes indicar el nombre del responsable que edita';
  END IF;

  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo de la edición es obligatorio';
  END IF;

  IF p_monto_autorizado IS NOT NULL AND p_monto_autorizado <= 0 THEN
    RAISE EXCEPTION 'El monto autorizado debe ser mayor a 0';
  END IF;

  SELECT * INTO v_sol
  FROM solicitudes_combustible
  WHERE id = p_solicitud_id
  FOR UPDATE;

  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'La solicitud no existe';
  END IF;

  IF v_sol.eliminado THEN
    RAISE EXCEPTION 'No se puede editar una solicitud eliminada';
  END IF;

  v_antes := jsonb_strip_nulls(jsonb_build_object(
    'monto_autorizado', CASE WHEN p_monto_autorizado IS NOT NULL AND p_monto_autorizado IS DISTINCT FROM v_sol.monto_autorizado THEN v_sol.monto_autorizado END,
    'motivo_rechazo', CASE WHEN v_motivo_rechazo_nuevo IS NOT NULL AND v_motivo_rechazo_nuevo IS DISTINCT FROM v_sol.motivo_rechazo THEN v_sol.motivo_rechazo END,
    'autorizado_por', CASE WHEN v_autorizado_por_nuevo IS NOT NULL AND v_autorizado_por_nuevo IS DISTINCT FROM v_sol.autorizado_por THEN v_sol.autorizado_por END,
    'cargado_por', CASE WHEN v_cargado_por_nuevo IS NOT NULL AND v_cargado_por_nuevo IS DISTINCT FROM v_sol.cargado_por THEN v_sol.cargado_por END
  ));

  UPDATE solicitudes_combustible
  SET monto_autorizado = COALESCE(p_monto_autorizado, monto_autorizado),
      motivo_rechazo = COALESCE(v_motivo_rechazo_nuevo, motivo_rechazo),
      autorizado_por = COALESCE(v_autorizado_por_nuevo, autorizado_por),
      cargado_por = COALESCE(v_cargado_por_nuevo, cargado_por)
  WHERE id = p_solicitud_id
  RETURNING * INTO v_sol;

  v_despues := jsonb_strip_nulls(jsonb_build_object(
    'monto_autorizado', CASE WHEN v_antes ? 'monto_autorizado' THEN v_sol.monto_autorizado END,
    'motivo_rechazo', CASE WHEN v_antes ? 'motivo_rechazo' THEN v_sol.motivo_rechazo END,
    'autorizado_por', CASE WHEN v_antes ? 'autorizado_por' THEN v_sol.autorizado_por END,
    'cargado_por', CASE WHEN v_antes ? 'cargado_por' THEN v_sol.cargado_por END
  ));

  IF v_antes = '{}'::JSONB THEN
    RAISE EXCEPTION 'No hay cambios que guardar';
  END IF;

  INSERT INTO solicitudes_combustible_auditoria
    (solicitud_id, accion, estado_anterior, estado_nuevo, usuario, comentario, metadata)
  VALUES (
    p_solicitud_id, 'edicion_admin', v_sol.estado, v_sol.estado, TRIM(p_usuario), TRIM(p_motivo),
    jsonb_build_object('antes', v_antes, 'despues', v_despues)
  );

  RETURN v_sol;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- 3. RPC: ELIMINAR (SOFT DELETE) CON MOTIVO OBLIGATORIO
-- =========================================================
CREATE OR REPLACE FUNCTION eliminar_solicitud_combustible_admin(
  p_solicitud_id UUID,
  p_usuario TEXT,
  p_motivo TEXT
)
RETURNS solicitudes_combustible
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sol solicitudes_combustible%ROWTYPE;
BEGIN
  IF p_usuario IS NULL OR LENGTH(TRIM(p_usuario)) = 0 THEN
    RAISE EXCEPTION 'Debes indicar el nombre del responsable que elimina';
  END IF;

  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo de la eliminación es obligatorio';
  END IF;

  SELECT * INTO v_sol
  FROM solicitudes_combustible
  WHERE id = p_solicitud_id
  FOR UPDATE;

  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'La solicitud no existe';
  END IF;

  IF v_sol.eliminado THEN
    RAISE EXCEPTION 'La solicitud ya fue eliminada';
  END IF;

  UPDATE solicitudes_combustible
  SET eliminado = TRUE
  WHERE id = p_solicitud_id
  RETURNING * INTO v_sol;

  INSERT INTO solicitudes_combustible_auditoria
    (solicitud_id, accion, estado_anterior, estado_nuevo, usuario, comentario, metadata)
  VALUES (
    p_solicitud_id, 'eliminacion_admin', v_sol.estado, v_sol.estado, TRIM(p_usuario), TRIM(p_motivo),
    jsonb_build_object(
      'estado_al_eliminar', v_sol.estado,
      'monto_solicitado', v_sol.monto_solicitado,
      'monto_autorizado', v_sol.monto_autorizado
    )
  );

  RETURN v_sol;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- 4. GRANTS
-- =========================================================
GRANT EXECUTE ON FUNCTION editar_solicitud_combustible_admin(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION eliminar_solicitud_combustible_admin(UUID, TEXT, TEXT)
  TO anon, authenticated, service_role;

-- =========================================================
-- 5. VISTA: exponer eliminado (mantiene el LEFT JOIN de v2)
-- =========================================================
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
  sc.edenred_evidencia_path,
  sc.eliminado
FROM solicitudes_combustible sc
JOIN vehiculos v ON v.codigo = sc.vehiculo_codigo
JOIN conductores c ON c.id = sc.conductor_id
LEFT JOIN centros_costo cc ON cc.id = sc.centro_costo_id;
