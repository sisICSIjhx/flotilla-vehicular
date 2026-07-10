-- =========================================================
-- PARCHE: incluir el APODO del vehículo en la notificación
-- de "Nueva Solicitud de Combustible" (WhatsApp / correo /
-- campanita del admin).
--
-- Idempotente: solo reemplaza la función del trigger que ya
-- existe en producción (creada por supabase_fuel_requests.sql).
-- Ejecutar en el SQL Editor de Supabase.
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
    ' | Monto: $' || NEW.monto_solicitado ||
    ' | Hora: ' || TO_CHAR(NEW.created_at, 'DD/MM/YYYY HH24:MI') ||
    CASE WHEN NEW.emergencia THEN ' | EMERGENCIA' WHEN NEW.fuera_horario THEN ' | Fuera de horario' ELSE '' END,
    NEW.id,
    NEW.vehiculo_codigo
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
