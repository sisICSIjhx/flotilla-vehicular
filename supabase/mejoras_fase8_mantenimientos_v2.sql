-- =========================================================
-- MEJORAS FASE 8: MANTENIMIENTOS V2
-- =========================================================
-- Ejecutar en el SQL editor de Supabase DESPUÉS de:
--   - mejoras_fase4_mantenimientos.sql
--   - mejoras_fase5_refacciones.sql
--   - supabase_fuel_requests.sql        (tabla notificaciones)
--   - supabase_notificaciones_push.sql  (trigger -> Edge Function WhatsApp/correo)
--
-- Incluye:
--   1. Programa preventivo por defecto: cada 10,000 km desde el km 0
--      (umbrales en 10,000, 20,000, 30,000... sin importar en qué km
--      exacto se hizo el último servicio)
--   2. Columna categoria en refacciones ('refaccion' | 'gasto') para
--      separar refacciones de otros gastos (tapetes, extintores, etc.)
--   3. Tabla mantenimientos_alertas (bitácora/dedup de avisos)
--   4. Función evaluar_alertas_mantenimiento():
--        - 'previo'  : ~1 semana antes según km diario promedio (1 sola vez por umbral)
--        - 'vencido' : al llegar/pasar el umbral, se repite en cada corrida
--                      hasta que la unidad se registre en taller o se
--                      complete el preventivo (que recorre el umbral)
--   5. Trigger inmediato al cruzar el umbral de km (aviso en el momento,
--      normalmente al cerrar el recorrido que lo rebasó)
--   6. pg_cron: 2 corridas al día en horario de atención
--
-- Los avisos se insertan en la tabla notificaciones (destinatario=admin),
-- por lo que viajan por el mismo canal ya instalado: campanita en la app
-- + WhatsApp (CallMeBot) + correo (Resend) vía la Edge Function
-- notificar-solicitud.
-- =========================================================

-- =========================================================
-- 1. PROGRAMA PREVENTIVO POR DEFECTO: 10,000 KM
-- =========================================================
ALTER TABLE vehiculos
  ALTER COLUMN intervalo_mantenimiento_km SET DEFAULT 10000;

UPDATE vehiculos
SET intervalo_mantenimiento_km = 10000
WHERE intervalo_mantenimiento_km IS NULL;

-- Base del próximo umbral: el último múltiplo de 10,000 ya alcanzado.
-- Ej: unidad con 87,340 km => km_ultimo_mantenimiento = 80,000 y el
-- próximo servicio toca a los 90,000. Ajustable por unidad desde
-- /admin/mantenimientos/unidades si la realidad es otra.
UPDATE vehiculos
SET km_ultimo_mantenimiento = FLOOR(km_actual / 10000.0)::INTEGER * 10000
WHERE km_ultimo_mantenimiento IS NULL;

-- =========================================================
-- 2. CATEGORÍA EN REFACCIONES: refacción vs otro gasto
-- =========================================================
ALTER TABLE refacciones
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(20) NOT NULL DEFAULT 'refaccion';

ALTER TABLE refacciones
  DROP CONSTRAINT IF EXISTS check_categoria_refaccion;

ALTER TABLE refacciones
  ADD CONSTRAINT check_categoria_refaccion
  CHECK (categoria IN ('refaccion', 'gasto'));

CREATE INDEX IF NOT EXISTS idx_refacciones_categoria
  ON refacciones(categoria);

-- =========================================================
-- 3. BITÁCORA DE ALERTAS DE MANTENIMIENTO
-- =========================================================
CREATE TABLE IF NOT EXISTS mantenimientos_alertas (
  id SERIAL PRIMARY KEY,
  vehiculo_codigo VARCHAR(20) NOT NULL REFERENCES vehiculos(codigo),
  proximo_km INTEGER NOT NULL,        -- umbral que disparó la alerta
  etapa VARCHAR(20) NOT NULL,         -- previo | vencido
  km_al_avisar INTEGER,               -- km_actual cuando se envió
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT check_etapa_alerta
    CHECK (etapa IN ('previo', 'vencido'))
);

-- La pre-alerta ('previo') se envía UNA sola vez por umbral;
-- 'vencido' se repite, por eso el índice único es parcial.
CREATE UNIQUE INDEX IF NOT EXISTS ux_alerta_previa_por_umbral
  ON mantenimientos_alertas(vehiculo_codigo, proximo_km)
  WHERE etapa = 'previo';

CREATE INDEX IF NOT EXISTS idx_mant_alertas_vehiculo
  ON mantenimientos_alertas(vehiculo_codigo, created_at DESC);

-- Solo escriben las funciones SECURITY DEFINER; el frontend no la usa.
ALTER TABLE mantenimientos_alertas DISABLE ROW LEVEL SECURITY;

-- =========================================================
-- 4. FUNCIÓN: EVALUAR ALERTAS DE MANTENIMIENTO
-- =========================================================
-- USO MANUAL (prueba): SELECT * FROM evaluar_alertas_mantenimiento();
--
-- Por cada vehículo activo con programa:
--   proximo_km = siguiente múltiplo del intervalo por arriba del
--                km del último mantenimiento (umbrales desde km 0)
--   km_diario  = promedio de recorridos cerrados de los últimos 30 días
--
--   - Si ya está en taller           -> no avisa
--   - Si km_actual >= proximo_km     -> 'vencido' (avisa en cada corrida)
--   - Si faltan <= 7 días de km      -> 'previo'  (avisa una sola vez)
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

    v_proximo := (FLOOR(COALESCE(v.km_ultimo_mantenimiento, 0)::NUMERIC
                  / v.intervalo_mantenimiento_km) + 1)::INTEGER
                 * v.intervalo_mantenimiento_km;
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

-- =========================================================
-- 5. TRIGGER: AVISO INMEDIATO AL CRUZAR EL UMBRAL
-- =========================================================
-- Se dispara cuando km_actual sube (normalmente al cerrar el
-- recorrido que rebasó el umbral): avisa en el momento en que
-- la unidad "ya llegó" al km de su mantenimiento.
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

  v_proximo := (FLOOR(COALESCE(NEW.km_ultimo_mantenimiento, 0)::NUMERIC
                / NEW.intervalo_mantenimiento_km) + 1)::INTEGER
               * NEW.intervalo_mantenimiento_km;

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

DROP TRIGGER IF EXISTS trg_alerta_mantenimiento_km ON vehiculos;
CREATE TRIGGER trg_alerta_mantenimiento_km
AFTER UPDATE OF km_actual ON vehiculos
FOR EACH ROW
EXECUTE FUNCTION alerta_mantenimiento_al_llegar_km();

-- =========================================================
-- 6. PG_CRON: 2 CORRIDAS AL DÍA EN HORARIO DE ATENCIÓN
-- =========================================================
-- Horario de atención: 08:00 - 18:00 hora estándar central (GMT-6).
-- pg_cron corre en UTC; GMT-6 es fijo (sin horario de verano):
--   '0 14 * * *' =  8:00 am GMT-6 (al abrir)
--   '0 20 * * *' =  2:00 pm GMT-6 (media tarde)
-- Para cambiar el horario: ajustar el cron y volver a correr
-- estas dos sentencias (cron.schedule con el mismo nombre
-- reemplaza el job existente).
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'alertas-mantenimiento-manana',
  '0 14 * * *',
  $$SELECT evaluar_alertas_mantenimiento()$$
);

SELECT cron.schedule(
  'alertas-mantenimiento-tarde',
  '0 20 * * *',
  $$SELECT evaluar_alertas_mantenimiento()$$
);

-- Ver jobs programados:      SELECT * FROM cron.job;
-- Historial de ejecuciones:  SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- Prueba manual inmediata:   SELECT * FROM evaluar_alertas_mantenimiento();
