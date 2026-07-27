-- =========================================================
-- PARCHE: el monto no se veía en los mensajes de WhatsApp
--
-- Causa: CallMeBot (el servicio que reenvía las notificaciones
-- a WhatsApp) interpreta "$1", "$2"... dentro del texto como
-- una referencia de captura de regex (estilo preg_replace de
-- PHP) y lo sustituye por vacío al no existir tal grupo. Por
-- eso "Monto: $1000.00" llegaba como "Monto: 000.00" — se
-- comía el "$1".
--
-- Fix: separar el "$" del número con un espacio ("$ 1000.00")
-- para que nunca se forme el patrón "$<dígito>".
--
-- Idempotente: solo reemplaza las 3 funciones que ya existen
-- en producción. Ejecutar en el SQL Editor de Supabase.
-- =========================================================

CREATE OR REPLACE FUNCTION registrar_creacion_solicitud()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_apodo TEXT;
BEGIN
  SELECT apodo INTO v_apodo
  FROM vehiculos
  WHERE codigo = NEW.vehiculo_codigo;

  INSERT INTO solicitudes_combustible_auditoria
    (solicitud_id, accion, estado_anterior, estado_nuevo, usuario, comentario, metadata)
  VALUES (
    NEW.id, 'creacion', NULL, 'pendiente', NEW.solicitado_por,
    'Solicitud creada desde la app',
    jsonb_build_object(
      'monto_solicitado', NEW.monto_solicitado,
      'monto_sugerido', NEW.monto_sugerido,
      'fuera_horario', NEW.fuera_horario,
      'emergencia', NEW.emergencia
    )
  );

  INSERT INTO notificaciones
    (tipo, destinatario, titulo, mensaje, solicitud_id, vehiculo_codigo)
  VALUES (
    'nueva_solicitud',
    'admin',
    'Nueva Solicitud de Combustible',
    'Folio ' || COALESCE(NEW.folio, '') ||
    ' | Unidad: ' || NEW.vehiculo_codigo ||
    COALESCE(' "' || NULLIF(TRIM(v_apodo), '') || '"', '') ||
    COALESCE(' (' || NEW.placa || ')', '') ||
    ' | Operador: ' || COALESCE(NEW.solicitado_por, 'N/A') ||
    ' | Destino: ' || COALESCE(NEW.destino, 'N/A') ||
    ' | KM: ' || NEW.km_solicitud ||
    ' | Nivel: ' || NEW.combustible_nivel || '/8' ||
    ' | Monto: $ ' || NEW.monto_solicitado ||
    ' | Hora: ' || TO_CHAR(NEW.created_at AT TIME ZONE 'America/Mexico_City', 'DD/MM/YYYY HH24:MI') ||
    CASE WHEN NEW.emergencia THEN ' | EMERGENCIA' WHEN NEW.fuera_horario THEN ' | Fuera de horario' ELSE '' END,
    NEW.id,
    NEW.vehiculo_codigo
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION autorizar_solicitud_combustible(
  p_solicitud_id UUID,
  p_usuario TEXT,
  p_monto_autorizado NUMERIC,
  p_comentario TEXT DEFAULT NULL
)
RETURNS solicitudes_combustible
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sol solicitudes_combustible%ROWTYPE;
BEGIN
  IF p_usuario IS NULL OR LENGTH(TRIM(p_usuario)) = 0 THEN
    RAISE EXCEPTION 'Debes indicar el nombre del responsable que autoriza';
  END IF;

  IF p_monto_autorizado IS NULL OR p_monto_autorizado <= 0 THEN
    RAISE EXCEPTION 'El monto autorizado debe ser mayor a 0';
  END IF;

  SELECT * INTO v_sol
  FROM solicitudes_combustible
  WHERE id = p_solicitud_id
  FOR UPDATE;

  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'La solicitud no existe';
  END IF;

  IF v_sol.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Solo se pueden autorizar solicitudes pendientes (estado actual: %)', v_sol.estado;
  END IF;

  -- Un operador no puede autorizar su propia solicitud
  IF v_sol.solicitado_por IS NOT NULL
     AND LOWER(TRIM(p_usuario)) = LOWER(TRIM(v_sol.solicitado_por)) THEN
    RAISE EXCEPTION 'El operador que solicitó no puede autorizar su propia solicitud';
  END IF;

  UPDATE solicitudes_combustible
  SET estado = 'autorizada',
      monto_autorizado = ROUND(p_monto_autorizado, 2),
      fecha_autorizacion = NOW(),
      autorizado_por = TRIM(p_usuario)
  WHERE id = p_solicitud_id
  RETURNING * INTO v_sol;

  INSERT INTO solicitudes_combustible_auditoria
    (solicitud_id, accion, estado_anterior, estado_nuevo, usuario, comentario, metadata)
  VALUES (
    p_solicitud_id, 'autorizacion', 'pendiente', 'autorizada', TRIM(p_usuario), p_comentario,
    jsonb_build_object('monto_solicitado', v_sol.monto_solicitado, 'monto_autorizado', v_sol.monto_autorizado)
  );

  INSERT INTO notificaciones (tipo, destinatario, titulo, mensaje, solicitud_id, vehiculo_codigo)
  VALUES (
    'resultado_solicitud', 'operador', 'Solicitud de combustible autorizada',
    'Folio ' || COALESCE(v_sol.folio, '') || ' autorizada por ' || TRIM(p_usuario) ||
    ' por $ ' || v_sol.monto_autorizado,
    p_solicitud_id, v_sol.vehiculo_codigo
  );

  RETURN v_sol;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION registrar_carga_edenred(
  p_solicitud_id UUID,
  p_usuario TEXT,
  p_monto_cargado NUMERIC,
  p_evidencia_path TEXT DEFAULT NULL,
  p_comentario TEXT DEFAULT NULL
)
RETURNS solicitudes_combustible
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sol solicitudes_combustible%ROWTYPE;
  v_monto_anterior NUMERIC;
BEGIN
  IF p_usuario IS NULL OR LENGTH(TRIM(p_usuario)) = 0 THEN
    RAISE EXCEPTION 'Debes indicar el nombre del usuario que registró la carga';
  END IF;

  IF p_monto_cargado IS NULL OR p_monto_cargado <= 0 THEN
    RAISE EXCEPTION 'El monto cargado debe ser mayor a 0';
  END IF;

  SELECT * INTO v_sol
  FROM solicitudes_combustible
  WHERE id = p_solicitud_id
  FOR UPDATE;

  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'La solicitud no existe';
  END IF;

  IF v_sol.estado <> 'autorizada' THEN
    RAISE EXCEPTION 'Solo se puede registrar carga Edenred de solicitudes autorizadas (estado actual: %)', v_sol.estado;
  END IF;

  v_monto_anterior := v_sol.monto_autorizado;

  UPDATE solicitudes_combustible
  SET estado = 'cargada_edenred',
      monto_autorizado = ROUND(p_monto_cargado, 2),
      fecha_carga_edenred = NOW(),
      cargado_por = TRIM(p_usuario),
      edenred_evidencia_path = COALESCE(p_evidencia_path, edenred_evidencia_path)
  WHERE id = p_solicitud_id
  RETURNING * INTO v_sol;

  INSERT INTO solicitudes_combustible_auditoria
    (solicitud_id, accion, estado_anterior, estado_nuevo, usuario, comentario, metadata)
  VALUES (
    p_solicitud_id, 'carga_edenred', 'autorizada', 'cargada_edenred', TRIM(p_usuario), p_comentario,
    jsonb_build_object(
      'monto_autorizado_anterior', v_monto_anterior,
      'monto_cargado', v_sol.monto_autorizado,
      'evidencia_path', v_sol.edenred_evidencia_path
    )
  );

  INSERT INTO notificaciones (tipo, destinatario, titulo, mensaje, solicitud_id, vehiculo_codigo)
  VALUES (
    'resultado_solicitud', 'operador', 'Combustible cargado en Edenred',
    'Folio ' || COALESCE(v_sol.folio, '') || ': carga Edenred registrada por ' || TRIM(p_usuario) ||
    ' por $ ' || v_sol.monto_autorizado,
    p_solicitud_id, v_sol.vehiculo_codigo
  );

  RETURN v_sol;
END;
$$ LANGUAGE plpgsql;
