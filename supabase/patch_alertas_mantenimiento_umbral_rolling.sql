-- =========================================================
-- PARCHE: las alertas de WhatsApp de mantenimiento seguían
-- llegando aunque el mantenimiento ya estaba actualizado
--
-- Causa raíz: mejoras_fase11_destino_mantenimiento.sql (Cambio 14)
-- cambió la fórmula del semáforo en el FRONTEND (calcularSemaforo,
-- src/app/admin/mantenimientos/shared.tsx) de "próximo múltiplo
-- fijo de 10,000 desde el km 0" a un umbral RODANTE:
--
--     proximo_km = km_ultimo_mantenimiento + intervalo
--
-- Pero las dos funciones del BACKEND que disparan los avisos por
-- WhatsApp (evaluar_alertas_mantenimiento(), corrida 2x/día por
-- pg_cron, y el trigger alerta_mantenimiento_al_llegar_km()) se
-- quedaron con la fórmula vieja de mejoras_fase8_mantenimientos_v2.sql:
--
--     proximo_km = (FLOOR(km_ultimo_mantenimiento / intervalo) + 1) * intervalo
--
-- Cuando un mantenimiento se completa con un km real que no cae
-- justo en un múltiplo de 10,000 (el caso normal: el taller no
-- espera a que el odómetro marque un número redondo), las dos
-- fórmulas divergen. Confirmado contra producción (2026-07-30):
--
--   VEH002: km_ultimo_mantenimiento=129,993, km_actual=130,901
--     Frontend (correcto): 129,993 + 10,000 = 139,993 -> faltan 9,092 km, todo bien
--     Backend  (bug):      siguiente múltiplo de 130,000          -> ya "vencido"
--     Resultado: WhatsApp "vencido" en cada corrida desde el 2026-07-21 (9+ días).
--
--   VEH012: mantenimiento completado el 2026-07-25 con km_al_ingreso=19,650
--     Frontend (correcto): 19,650 + 10,000 = 29,650 -> recién hecho, falta mucho
--     Backend  (bug):      siguiente múltiplo de 20,000, superado a los 419 km
--     Resultado: alerta "vencido" el 2026-07-30, 5 días después del servicio.
--
-- Fix: alinear las dos funciones del backend con la misma fórmula
-- rodante que ya usa el frontend, para que "mantenimiento actualizado
-- en la app" y "deja de avisar por WhatsApp" sean lo mismo.
--
-- Idempotente: solo reemplaza las 2 funciones que ya existen en
-- producción (mejoras_fase8_mantenimientos_v2.sql). Ejecutar en el
-- SQL Editor de Supabase. No requiere tocar mantenimientos_alertas
-- ni el cron: en la siguiente corrida, el umbral recalculado ya
-- queda por delante del km actual de VEH002/VEH012 y dejan de avisar.
-- =========================================================

CREATE OR REPLACE FUNCTION evaluar_alertas_mantenimiento()
RETURNS TABLE (
  r_vehiculo VARCHAR(20),
  r_etapa TEXT,
  r_proximo_km INTEGER,
  r_faltan_km INTEGER
)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_proximo INTEGER;
  v_faltan INTEGER;
  v_km_diario NUMERIC;
  v_dias_estimados INTEGER;
  v_etapa TEXT;
  v_titulo TEXT;
  v_mensaje TEXT;
  v_unidad TEXT;
BEGIN
  FOR v IN
    SELECT *
    FROM vehiculos
    WHERE estado = 'activo'
      AND intervalo_mantenimiento_km IS NOT NULL
      AND intervalo_mantenimiento_km > 0
  LOOP
    -- Unidad ya ingresada a taller: dejar de molestar
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM mantenimientos m
      WHERE m.vehiculo_codigo = v.codigo AND m.estado = 'en_taller'
    );

    -- Umbral rodante: igual que calcularSemaforo() en el frontend
    -- (shared.tsx) desde mejoras_fase11_destino_mantenimiento.sql.
    v_proximo := COALESCE(v.km_ultimo_mantenimiento, 0) + v.intervalo_mantenimiento_km;
    v_faltan := v_proximo - v.km_actual;

    SELECT COALESCE(SUM(r.km_regreso - r.km_salida), 0) / 30.0
    INTO v_km_diario
    FROM recorridos r
    WHERE r.vehiculo_codigo = v.codigo
      AND r.estado = 'cerrado'
      AND r.km_regreso IS NOT NULL
      AND r.fecha_salida >= NOW() - INTERVAL '30 days';

    v_unidad := v.codigo
      || COALESCE(' "' || v.apodo || '"', '')
      || COALESCE(' (' || v.placa || ')', '');

    IF v_faltan <= 0 THEN
      v_etapa := 'vencido';
      v_titulo := '🔴 Mantenimiento vencido: ' || v.codigo;
      v_mensaje := 'Unidad: ' || v_unidad
        || ' | KM actual: ' || v.km_actual
        || ' | Tocaba a los ' || v_proximo || ' km (vencido por '
        || (v.km_actual - v_proximo) || ' km)'
        || ' | Registra el ingreso a taller en la app para detener estos avisos';
    ELSIF v_km_diario > 0 AND v_faltan <= v_km_diario * 7 THEN
      -- Pre-alerta: una sola vez por umbral
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM mantenimientos_alertas a
        WHERE a.vehiculo_codigo = v.codigo
          AND a.proximo_km = v_proximo
          AND a.etapa = 'previo'
      );
      v_etapa := 'previo';
      v_dias_estimados := GREATEST(1, CEIL(v_faltan / v_km_diario))::INTEGER;
      v_titulo := '🟡 Mantenimiento próximo: ' || v.codigo;
      v_mensaje := 'Unidad: ' || v_unidad
        || ' | KM actual: ' || v.km_actual
        || ' | Próximo servicio a los ' || v_proximo || ' km (faltan '
        || v_faltan || ' km)'
        || ' | Al ritmo actual (~' || ROUND(v_km_diario) || ' km/día) llegará en ~'
        || v_dias_estimados || ' día(s). Ve agendando el taller';
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO mantenimientos_alertas (vehiculo_codigo, proximo_km, etapa, km_al_avisar)
    VALUES (v.codigo, v_proximo, v_etapa, v.km_actual);

    -- Viaja por el pipeline existente: campanita + WhatsApp + correo
    INSERT INTO notificaciones (tipo, destinatario, titulo, mensaje, vehiculo_codigo)
    VALUES ('mantenimiento_' || v_etapa, 'admin', v_titulo, v_mensaje, v.codigo);

    r_vehiculo := v.codigo;
    r_etapa := v_etapa;
    r_proximo_km := v_proximo;
    r_faltan_km := v_faltan;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION alerta_mantenimiento_al_llegar_km()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proximo INTEGER;
  v_unidad TEXT;
BEGIN
  IF NEW.intervalo_mantenimiento_km IS NULL
     OR NEW.intervalo_mantenimiento_km <= 0
     OR NEW.km_actual <= OLD.km_actual
     OR NEW.estado <> 'activo' THEN
    RETURN NEW;
  END IF;

  -- Umbral rodante: igual que calcularSemaforo() en el frontend
  -- (shared.tsx) desde mejoras_fase11_destino_mantenimiento.sql.
  v_proximo := COALESCE(NEW.km_ultimo_mantenimiento, 0) + NEW.intervalo_mantenimiento_km;

  -- Solo el instante en que se cruza el umbral
  IF OLD.km_actual >= v_proximo OR NEW.km_actual < v_proximo THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM mantenimientos m
    WHERE m.vehiculo_codigo = NEW.codigo AND m.estado = 'en_taller'
  ) THEN
    RETURN NEW;
  END IF;

  v_unidad := NEW.codigo
    || COALESCE(' "' || NEW.apodo || '"', '')
    || COALESCE(' (' || NEW.placa || ')', '');

  INSERT INTO mantenimientos_alertas (vehiculo_codigo, proximo_km, etapa, km_al_avisar)
  VALUES (NEW.codigo, v_proximo, 'vencido', NEW.km_actual);

  INSERT INTO notificaciones (tipo, destinatario, titulo, mensaje, vehiculo_codigo)
  VALUES (
    'mantenimiento_vencido',
    'admin',
    '🔴 Le toca mantenimiento: ' || NEW.codigo,
    'Unidad: ' || v_unidad
      || ' | Acaba de llegar a ' || NEW.km_actual || ' km'
      || ' | Le tocaba servicio a los ' || v_proximo || ' km'
      || ' | Registra el ingreso a taller en la app para detener estos avisos',
    NEW.codigo
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear el cierre del recorrido por un fallo del aviso
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ver jobs programados:      SELECT * FROM cron.job;
-- Historial de ejecuciones:  SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- Prueba manual inmediata:   SELECT * FROM evaluar_alertas_mantenimiento();
