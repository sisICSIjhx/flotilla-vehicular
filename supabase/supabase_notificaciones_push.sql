-- =========================================================
-- MODULO: NOTIFICACIONES EN TIEMPO REAL + WHATSAPP/CORREO
-- Script idempotente para el SQL Editor de Supabase.
-- Requiere haber ejecutado antes supabase_fuel_requests.sql
-- (crea la tabla notificaciones).
--
-- 1. Habilita Realtime sobre la tabla notificaciones
--    (la campanita de /solicitudes se actualiza en vivo).
-- 2. Crea un trigger con pg_net que, al insertarse una
--    notificación para admin, llama a la Edge Function
--    "notificar-solicitud" que envía WhatsApp y/o correo.
-- =========================================================

-- =========================================================
-- 1. REALTIME: publicar la tabla notificaciones
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notificaciones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notificaciones;
  END IF;
END;
$$;

-- =========================================================
-- 2. EXTENSION pg_net (peticiones HTTP asíncronas desde BD)
-- =========================================================
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =========================================================
-- 3. CONFIGURACION DEL WEBHOOK (una sola fila)
--    - habilitado: apagar/encender sin tocar triggers
--    - edge_function_url: URL de la Edge Function
--    - webhook_secret: debe coincidir con el secret
--      WEBHOOK_SECRET configurado en la Edge Function
-- =========================================================
CREATE TABLE IF NOT EXISTS notificaciones_push_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id), -- fuerza fila única
  habilitado BOOLEAN NOT NULL DEFAULT TRUE,
  edge_function_url TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE notificaciones_push_config IS
  'Configuración del webhook de notificaciones externas (WhatsApp/correo). Fila única. Sin policies: solo se administra desde el SQL Editor.';

-- RLS sin policies => invisible/inmutable para anon y authenticated
ALTER TABLE notificaciones_push_config ENABLE ROW LEVEL SECURITY;
GRANT ALL ON notificaciones_push_config TO service_role;

-- Config inicial (proyecto jyyglbjozzfzrbcnpksk)
INSERT INTO notificaciones_push_config (id, habilitado, edge_function_url, webhook_secret)
VALUES (
  TRUE,
  TRUE,
  'https://jyyglbjozzfzrbcnpksk.supabase.co/functions/v1/notificar-solicitud',
  '4f30ed6e1106a70837eb5ad7ad519aa15da3e6319c600ba9'
)
ON CONFLICT (id) DO NOTHING;

-- =========================================================
-- 4. TRIGGER: enviar notificación externa al insertar
--    una notificación dirigida al admin
-- =========================================================
CREATE OR REPLACE FUNCTION enviar_notificacion_externa()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg notificaciones_push_config%ROWTYPE;
BEGIN
  -- Solo notificaciones para la administración
  IF NEW.destinatario <> 'admin' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_cfg
  FROM notificaciones_push_config
  WHERE habilitado
  LIMIT 1;

  IF v_cfg.id IS NULL THEN
    RETURN NEW; -- webhook deshabilitado o sin configurar
  END IF;

  -- Llamada asíncrona: no bloquea ni retrasa el insert
  PERFORM net.http_post(
    url := v_cfg.edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_cfg.webhook_secret
    ),
    body := jsonb_build_object(
      'id', NEW.id,
      'tipo', NEW.tipo,
      'titulo', NEW.titulo,
      'mensaje', NEW.mensaje,
      'solicitud_id', NEW.solicitud_id,
      'vehiculo_codigo', NEW.vehiculo_codigo,
      'created_at', NEW.created_at
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear la operación original por un fallo del webhook
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enviar_notificacion_externa ON notificaciones;
CREATE TRIGGER trg_enviar_notificacion_externa
AFTER INSERT ON notificaciones
FOR EACH ROW
EXECUTE FUNCTION enviar_notificacion_externa();
