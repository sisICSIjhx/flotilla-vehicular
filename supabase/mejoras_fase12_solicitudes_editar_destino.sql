-- =========================================================
-- MEJORAS FASE 12: EDITAR DESTINO DE SOLICITUDES DE COMBUSTIBLE
-- =========================================================
-- CONTEXTO:
--   El destino/centro de costo de la solicitud se copia del recorrido
--   abierto al momento de solicitar. Si el recorrido quedó abierto por
--   error, la solicitud hereda un destino equivocado y antes no había
--   forma de corregirlo sin rechazar y volver a solicitar.
--
-- CAMBIOS:
--   1. editar_solicitud_combustible_admin acepta p_centro_costo_id.
--      Actualiza centro_costo_id y destino (nombre del centro) de la
--      solicitud. NO toca el recorrido vinculado.
--   2. Se puede editar en cualquier estado (incluida 'pendiente').
--   3. El cambio queda en solicitudes_combustible_auditoria igual que
--      las demás ediciones (antes/después + motivo obligatorio).
-- =========================================================

-- Se agrega un parámetro: hay que borrar la firma anterior para no
-- dejar dos sobrecargas (PostgREST no sabría cuál llamar).
DROP FUNCTION IF EXISTS editar_solicitud_combustible_admin(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION editar_solicitud_combustible_admin(
  p_solicitud_id UUID,
  p_usuario TEXT,
  p_motivo TEXT,
  p_monto_autorizado NUMERIC DEFAULT NULL,
  p_motivo_rechazo TEXT DEFAULT NULL,
  p_autorizado_por TEXT DEFAULT NULL,
  p_cargado_por TEXT DEFAULT NULL,
  p_centro_costo_id INTEGER DEFAULT NULL
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
  v_destino_nuevo TEXT;
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

  IF p_centro_costo_id IS NOT NULL THEN
    SELECT nombre INTO v_destino_nuevo
    FROM centros_costo
    WHERE id = p_centro_costo_id;

    IF v_destino_nuevo IS NULL THEN
      RAISE EXCEPTION 'El centro de costo indicado no existe';
    END IF;
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
    'cargado_por', CASE WHEN v_cargado_por_nuevo IS NOT NULL AND v_cargado_por_nuevo IS DISTINCT FROM v_sol.cargado_por THEN v_sol.cargado_por END,
    -- destino anterior puede ser NULL: se guarda como texto vacío para que strip_nulls no lo quite
    'destino', CASE WHEN p_centro_costo_id IS NOT NULL AND p_centro_costo_id IS DISTINCT FROM v_sol.centro_costo_id THEN COALESCE(v_sol.destino, '') END
  ));

  UPDATE solicitudes_combustible
  SET monto_autorizado = COALESCE(p_monto_autorizado, monto_autorizado),
      motivo_rechazo = COALESCE(v_motivo_rechazo_nuevo, motivo_rechazo),
      autorizado_por = COALESCE(v_autorizado_por_nuevo, autorizado_por),
      cargado_por = COALESCE(v_cargado_por_nuevo, cargado_por),
      centro_costo_id = COALESCE(p_centro_costo_id, centro_costo_id),
      destino = COALESCE(v_destino_nuevo, destino)
  WHERE id = p_solicitud_id
  RETURNING * INTO v_sol;

  v_despues := jsonb_strip_nulls(jsonb_build_object(
    'monto_autorizado', CASE WHEN v_antes ? 'monto_autorizado' THEN v_sol.monto_autorizado END,
    'motivo_rechazo', CASE WHEN v_antes ? 'motivo_rechazo' THEN v_sol.motivo_rechazo END,
    'autorizado_por', CASE WHEN v_antes ? 'autorizado_por' THEN v_sol.autorizado_por END,
    'cargado_por', CASE WHEN v_antes ? 'cargado_por' THEN v_sol.cargado_por END,
    'destino', CASE WHEN v_antes ? 'destino' THEN v_sol.destino END
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

GRANT EXECUTE ON FUNCTION editar_solicitud_combustible_admin(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, INTEGER)
  TO anon, authenticated, service_role;

-- Refrescar el caché de esquema de PostgREST para que vea la firma nueva
NOTIFY pgrst, 'reload schema';
