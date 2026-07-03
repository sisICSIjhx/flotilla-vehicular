-- =========================================================
-- MODULO: SOLICITUD DE COMBUSTIBLE
-- Script idempotente para el SQL Editor de Supabase.
-- No modifica ni borra tablas existentes.
--
-- Crea:
--   - solicitudes_combustible          (entidad principal)
--   - solicitudes_combustible_folios   (contador anual de folios)
--   - solicitudes_combustible_auditoria(historial de cambios)
--   - notificaciones                   (notificaciones internas)
--   - RPCs de transición de estado (SECURITY DEFINER)
--   - RLS: anon puede crear/leer; los cambios de estado SOLO
--     pasan por RPCs (no hay policy de UPDATE directa)
--   - Bucket de storage "edenred" para evidencias
-- =========================================================

-- =========================================================
-- TABLA: solicitudes_combustible_folios
-- Contador por año para folios SC-YYYY-000001
-- =========================================================
CREATE TABLE IF NOT EXISTS solicitudes_combustible_folios (
  anio INTEGER PRIMARY KEY,
  consecutivo INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE solicitudes_combustible_folios IS
  'Contador anual para generar folios únicos SC-YYYY-000001. Solo lo escribe el trigger asignar_folio_solicitud().';

-- =========================================================
-- TABLA: solicitudes_combustible
-- =========================================================
CREATE TABLE IF NOT EXISTS solicitudes_combustible (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Folio asignado por trigger (SC-YYYY-000001)
  folio VARCHAR(20) UNIQUE,

  -- Vínculos al recorrido activo y sus catálogos
  recorrido_id UUID NOT NULL REFERENCES recorridos(id),
  vehiculo_codigo VARCHAR(20) NOT NULL REFERENCES vehiculos(codigo),
  conductor_id INTEGER NOT NULL REFERENCES conductores(id),
  centro_costo_id INTEGER NOT NULL REFERENCES centros_costo(id),

  -- Snapshots informativos (el catálogo puede cambiar después)
  placa VARCHAR(20),
  solicitado_por VARCHAR(100),          -- nombre del operador al momento de solicitar
  destino VARCHAR(150),                 -- nombre del centro de costo destino al solicitar

  -- Captura del operador
  km_solicitud INTEGER NOT NULL,
  combustible_nivel SMALLINT NOT NULL,  -- misma escala 0-8 del sistema (0=Reserva, 2=1/4, 4=1/2, 6=3/4, 8=Lleno)
  tipo_carga VARCHAR(40) NOT NULL,
  monto_solicitado NUMERIC(10,2) NOT NULL,
  monto_sugerido NUMERIC(10,2),         -- calculado en frontend: litros faltantes * último precio conocido
  observaciones VARCHAR(500),

  -- Marcas de horario (VA-02)
  fuera_horario BOOLEAN NOT NULL DEFAULT FALSE,
  emergencia BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ciclo de vida
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  motivo_rechazo TEXT,
  fecha_autorizacion TIMESTAMP WITH TIME ZONE,
  autorizado_por VARCHAR(100),
  monto_autorizado NUMERIC(10,2),
  fecha_carga_edenred TIMESTAMP WITH TIME ZONE,
  cargado_por VARCHAR(100),
  edenred_evidencia_path TEXT,          -- URL pública en bucket "edenred"

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT check_solicitud_estado
    CHECK (estado IN ('pendiente', 'autorizada', 'rechazada', 'cancelada', 'cargada_edenred')),

  CONSTRAINT check_solicitud_tipo_carga
    CHECK (tipo_carga IN (
      'operacion_campo',
      'actividades_administrativas',
      'atencion_usuario',
      'clientes_potenciales',
      'proyecto_alex',
      'prestamo_personal',
      'viaje_foraneo',
      'emergencia_operativa'
    )),

  CONSTRAINT check_solicitud_km
    CHECK (km_solicitud >= 0),

  CONSTRAINT check_solicitud_nivel
    CHECK (combustible_nivel BETWEEN 0 AND 8),

  CONSTRAINT check_solicitud_monto
    CHECK (monto_solicitado > 0),

  CONSTRAINT check_solicitud_monto_sugerido
    CHECK (monto_sugerido IS NULL OR monto_sugerido >= 0),

  CONSTRAINT check_solicitud_monto_autorizado
    CHECK (monto_autorizado IS NULL OR monto_autorizado > 0),

  -- Si el monto supera en más de 30% al sugerido, exige justificación
  CONSTRAINT check_solicitud_justificacion_monto
    CHECK (
      monto_sugerido IS NULL
      OR monto_sugerido = 0
      OR monto_solicitado <= monto_sugerido * 1.30
      OR (observaciones IS NOT NULL AND LENGTH(TRIM(observaciones)) >= 10)
    ),

  -- Rechazo requiere motivo
  CONSTRAINT check_solicitud_rechazo_motivo
    CHECK (
      estado <> 'rechazada'
      OR (motivo_rechazo IS NOT NULL AND LENGTH(TRIM(motivo_rechazo)) > 0)
    ),

  -- Carga Edenred requiere fecha, usuario y monto
  CONSTRAINT check_solicitud_carga_edenred
    CHECK (
      estado <> 'cargada_edenred'
      OR (fecha_carga_edenred IS NOT NULL AND cargado_por IS NOT NULL AND monto_autorizado IS NOT NULL)
    )
);

COMMENT ON TABLE solicitudes_combustible IS
  'Solicitudes formales de combustible vinculadas al recorrido activo. Los cambios de estado solo pasan por las RPCs autorizar/rechazar/cancelar/registrar_carga_edenred.';
COMMENT ON COLUMN solicitudes_combustible.combustible_nivel IS
  'Escala 0-8 en octavos, igual que recorridos y cargas_gasolina (0=Reserva, 1=1/8, ..., 8=Lleno). Se captura con el FuelGauge.';
COMMENT ON COLUMN solicitudes_combustible.monto_sugerido IS
  'Calculado en frontend: litros faltantes para llenar tanque * último precio_litro conocido del vehículo. NULL si no hay precio de referencia.';

-- =========================================================
-- TABLA: solicitudes_combustible_auditoria
-- =========================================================
CREATE TABLE IF NOT EXISTS solicitudes_combustible_auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id UUID NOT NULL REFERENCES solicitudes_combustible(id) ON DELETE CASCADE,
  accion VARCHAR(40) NOT NULL,          -- creacion | autorizacion | rechazo | cancelacion | carga_edenred | cambio_evidencia
  estado_anterior VARCHAR(20),
  estado_nuevo VARCHAR(20),
  usuario VARCHAR(100),
  comentario TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE solicitudes_combustible_auditoria IS
  'Bitácora inmutable de eventos de solicitudes de combustible. Solo escriben los triggers y RPCs (SECURITY DEFINER).';

-- =========================================================
-- TABLA: notificaciones
-- (no existía sistema de notificaciones en el proyecto)
-- =========================================================
CREATE TABLE IF NOT EXISTS notificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo VARCHAR(40) NOT NULL,            -- nueva_solicitud | resultado_solicitud
  destinatario VARCHAR(20) NOT NULL DEFAULT 'admin',
  titulo VARCHAR(120) NOT NULL,
  mensaje TEXT,
  solicitud_id UUID REFERENCES solicitudes_combustible(id) ON DELETE CASCADE,
  vehiculo_codigo VARCHAR(20),
  leida BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT check_notificacion_destinatario
    CHECK (destinatario IN ('admin', 'operador'))
);

COMMENT ON TABLE notificaciones IS
  'Notificaciones internas de la plataforma. destinatario=admin se muestran en /solicitudes; destinatario=operador se reflejan en la vista del vehículo. Preparada para email/push futuro.';

-- =========================================================
-- INDICES
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_solicitudes_comb_estado
  ON solicitudes_combustible(estado);

CREATE INDEX IF NOT EXISTS idx_solicitudes_comb_vehiculo
  ON solicitudes_combustible(vehiculo_codigo);

CREATE INDEX IF NOT EXISTS idx_solicitudes_comb_vehiculo_created
  ON solicitudes_combustible(vehiculo_codigo, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_solicitudes_comb_conductor
  ON solicitudes_combustible(conductor_id);

CREATE INDEX IF NOT EXISTS idx_solicitudes_comb_centro_costo
  ON solicitudes_combustible(centro_costo_id);

CREATE INDEX IF NOT EXISTS idx_solicitudes_comb_recorrido
  ON solicitudes_combustible(recorrido_id);

CREATE INDEX IF NOT EXISTS idx_solicitudes_comb_created
  ON solicitudes_combustible(created_at);

CREATE INDEX IF NOT EXISTS idx_solicitudes_comb_auditoria_solicitud
  ON solicitudes_combustible_auditoria(solicitud_id, created_at);

CREATE INDEX IF NOT EXISTS idx_notificaciones_no_leidas
  ON notificaciones(destinatario, leida, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notificaciones_vehiculo
  ON notificaciones(vehiculo_codigo);

-- =========================================================
-- TRIGGER: updated_at (reutiliza set_updated_at existente)
-- =========================================================
DROP TRIGGER IF EXISTS trg_solicitudes_combustible_updated_at ON solicitudes_combustible;
CREATE TRIGGER trg_solicitudes_combustible_updated_at
BEFORE UPDATE ON solicitudes_combustible
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =========================================================
-- TRIGGER: folio automático SC-YYYY-000001
-- SECURITY DEFINER para poder escribir el contador aunque
-- el insert venga del rol anon.
-- =========================================================
CREATE OR REPLACE FUNCTION asignar_folio_solicitud()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anio INTEGER := EXTRACT(YEAR FROM NOW())::INTEGER;
  v_consecutivo INTEGER;
BEGIN
  -- Toda solicitud nueva nace pendiente, sin importar lo que mande el cliente
  NEW.estado := 'pendiente';
  NEW.fecha_autorizacion := NULL;
  NEW.autorizado_por := NULL;
  NEW.monto_autorizado := NULL;
  NEW.fecha_carga_edenred := NULL;
  NEW.cargado_por := NULL;
  NEW.motivo_rechazo := NULL;

  -- ON CONFLICT DO UPDATE serializa por fila => folio único garantizado
  INSERT INTO solicitudes_combustible_folios (anio, consecutivo)
  VALUES (v_anio, 1)
  ON CONFLICT (anio)
  DO UPDATE SET consecutivo = solicitudes_combustible_folios.consecutivo + 1
  RETURNING consecutivo INTO v_consecutivo;

  NEW.folio := 'SC-' || v_anio || '-' || LPAD(v_consecutivo::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asignar_folio_solicitud ON solicitudes_combustible;
CREATE TRIGGER trg_asignar_folio_solicitud
BEFORE INSERT ON solicitudes_combustible
FOR EACH ROW
EXECUTE FUNCTION asignar_folio_solicitud();

-- =========================================================
-- TRIGGER: validar recorrido activo y kilometraje al crear
-- =========================================================
CREATE OR REPLACE FUNCTION validar_solicitud_combustible()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recorrido RECORD;
BEGIN
  SELECT r.estado, r.km_salida, r.vehiculo_codigo
  INTO v_recorrido
  FROM recorridos r
  WHERE r.id = NEW.recorrido_id;

  IF v_recorrido IS NULL THEN
    RAISE EXCEPTION 'El recorrido indicado no existe';
  END IF;

  IF v_recorrido.estado <> 'abierto' THEN
    RAISE EXCEPTION 'No es posible solicitar combustible sin un recorrido activo.';
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

DROP TRIGGER IF EXISTS trg_validar_solicitud_combustible ON solicitudes_combustible;
CREATE TRIGGER trg_validar_solicitud_combustible
BEFORE INSERT ON solicitudes_combustible
FOR EACH ROW
EXECUTE FUNCTION validar_solicitud_combustible();

-- =========================================================
-- TRIGGER: auditoría + notificación al crear solicitud
-- =========================================================
CREATE OR REPLACE FUNCTION registrar_creacion_solicitud()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

DROP TRIGGER IF EXISTS trg_registrar_creacion_solicitud ON solicitudes_combustible;
CREATE TRIGGER trg_registrar_creacion_solicitud
AFTER INSERT ON solicitudes_combustible
FOR EACH ROW
EXECUTE FUNCTION registrar_creacion_solicitud();

-- =========================================================
-- RPC: AUTORIZAR SOLICITUD
-- =========================================================
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
    ' por $' || v_sol.monto_autorizado,
    p_solicitud_id, v_sol.vehiculo_codigo
  );

  RETURN v_sol;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- RPC: RECHAZAR SOLICITUD (motivo obligatorio)
-- =========================================================
CREATE OR REPLACE FUNCTION rechazar_solicitud_combustible(
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
    RAISE EXCEPTION 'Debes indicar el nombre del responsable que rechaza';
  END IF;

  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo de rechazo es obligatorio';
  END IF;

  SELECT * INTO v_sol
  FROM solicitudes_combustible
  WHERE id = p_solicitud_id
  FOR UPDATE;

  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'La solicitud no existe';
  END IF;

  IF v_sol.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Solo se pueden rechazar solicitudes pendientes (estado actual: %)', v_sol.estado;
  END IF;

  UPDATE solicitudes_combustible
  SET estado = 'rechazada',
      motivo_rechazo = TRIM(p_motivo),
      fecha_autorizacion = NOW(),
      autorizado_por = TRIM(p_usuario)
  WHERE id = p_solicitud_id
  RETURNING * INTO v_sol;

  INSERT INTO solicitudes_combustible_auditoria
    (solicitud_id, accion, estado_anterior, estado_nuevo, usuario, comentario)
  VALUES (p_solicitud_id, 'rechazo', 'pendiente', 'rechazada', TRIM(p_usuario), TRIM(p_motivo));

  INSERT INTO notificaciones (tipo, destinatario, titulo, mensaje, solicitud_id, vehiculo_codigo)
  VALUES (
    'resultado_solicitud', 'operador', 'Solicitud de combustible rechazada',
    'Folio ' || COALESCE(v_sol.folio, '') || ' rechazada por ' || TRIM(p_usuario) ||
    '. Motivo: ' || TRIM(p_motivo),
    p_solicitud_id, v_sol.vehiculo_codigo
  );

  RETURN v_sol;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- RPC: CANCELAR SOLICITUD
-- =========================================================
CREATE OR REPLACE FUNCTION cancelar_solicitud_combustible(
  p_solicitud_id UUID,
  p_usuario TEXT,
  p_motivo TEXT DEFAULT NULL
)
RETURNS solicitudes_combustible
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sol solicitudes_combustible%ROWTYPE;
  v_estado_anterior VARCHAR(20);
BEGIN
  IF p_usuario IS NULL OR LENGTH(TRIM(p_usuario)) = 0 THEN
    RAISE EXCEPTION 'Debes indicar el nombre del usuario que cancela';
  END IF;

  SELECT * INTO v_sol
  FROM solicitudes_combustible
  WHERE id = p_solicitud_id
  FOR UPDATE;

  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'La solicitud no existe';
  END IF;

  IF v_sol.estado NOT IN ('pendiente', 'autorizada') THEN
    RAISE EXCEPTION 'Solo se pueden cancelar solicitudes pendientes o autorizadas (estado actual: %)', v_sol.estado;
  END IF;

  v_estado_anterior := v_sol.estado;

  UPDATE solicitudes_combustible
  SET estado = 'cancelada'
  WHERE id = p_solicitud_id
  RETURNING * INTO v_sol;

  INSERT INTO solicitudes_combustible_auditoria
    (solicitud_id, accion, estado_anterior, estado_nuevo, usuario, comentario)
  VALUES (p_solicitud_id, 'cancelacion', v_estado_anterior, 'cancelada', TRIM(p_usuario), p_motivo);

  INSERT INTO notificaciones (tipo, destinatario, titulo, mensaje, solicitud_id, vehiculo_codigo)
  VALUES (
    'resultado_solicitud', 'operador', 'Solicitud de combustible cancelada',
    'Folio ' || COALESCE(v_sol.folio, '') || ' cancelada por ' || TRIM(p_usuario) ||
    COALESCE('. Motivo: ' || p_motivo, ''),
    p_solicitud_id, v_sol.vehiculo_codigo
  );

  RETURN v_sol;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- RPC: REGISTRAR CARGA EDENRED
-- =========================================================
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
    ' por $' || v_sol.monto_autorizado,
    p_solicitud_id, v_sol.vehiculo_codigo
  );

  RETURN v_sol;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- RPC: ACTUALIZAR EVIDENCIA EDENRED
-- =========================================================
CREATE OR REPLACE FUNCTION actualizar_evidencia_edenred(
  p_solicitud_id UUID,
  p_usuario TEXT,
  p_evidencia_path TEXT
)
RETURNS solicitudes_combustible
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sol solicitudes_combustible%ROWTYPE;
  v_anterior TEXT;
BEGIN
  IF p_usuario IS NULL OR LENGTH(TRIM(p_usuario)) = 0 THEN
    RAISE EXCEPTION 'Debes indicar el nombre del usuario';
  END IF;

  IF p_evidencia_path IS NULL OR LENGTH(TRIM(p_evidencia_path)) = 0 THEN
    RAISE EXCEPTION 'La evidencia es obligatoria';
  END IF;

  SELECT * INTO v_sol
  FROM solicitudes_combustible
  WHERE id = p_solicitud_id
  FOR UPDATE;

  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'La solicitud no existe';
  END IF;

  IF v_sol.estado NOT IN ('autorizada', 'cargada_edenred') THEN
    RAISE EXCEPTION 'Solo se puede adjuntar evidencia a solicitudes autorizadas o cargadas';
  END IF;

  v_anterior := v_sol.edenred_evidencia_path;

  UPDATE solicitudes_combustible
  SET edenred_evidencia_path = TRIM(p_evidencia_path)
  WHERE id = p_solicitud_id
  RETURNING * INTO v_sol;

  INSERT INTO solicitudes_combustible_auditoria
    (solicitud_id, accion, estado_anterior, estado_nuevo, usuario, comentario, metadata)
  VALUES (
    p_solicitud_id, 'cambio_evidencia', v_sol.estado, v_sol.estado, TRIM(p_usuario),
    'Evidencia Edenred actualizada',
    jsonb_build_object('evidencia_anterior', v_anterior, 'evidencia_nueva', v_sol.edenred_evidencia_path)
  );

  RETURN v_sol;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- VISTA: reporte resumido para la vista administrativa
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
  sc.edenred_evidencia_path
FROM solicitudes_combustible sc
JOIN vehiculos v ON v.codigo = sc.vehiculo_codigo
JOIN conductores c ON c.id = sc.conductor_id
JOIN centros_costo cc ON cc.id = sc.centro_costo_id;

COMMENT ON VIEW v_solicitudes_combustible_resumen IS
  'Vista para reportes: solicitudes con nombres de operador, centro de costo y datos del vehículo ya resueltos.';

-- =========================================================
-- RLS Y POLICIES
-- Modelo actual del proyecto: la app corre con anon key y el
-- acceso administrativo se protege con PasswordGate en frontend.
-- Refuerzo a nivel BD: anon puede INSERTAR (solo pendientes,
-- forzado por trigger) y LEER; NO puede hacer UPDATE/DELETE
-- directo. Toda transición de estado pasa por las RPCs.
-- =========================================================
ALTER TABLE solicitudes_combustible ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_combustible_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_combustible_folios ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'solicitudes_combustible' AND policyname = 'Insert anónimo en solicitudes_combustible'
  ) THEN
    CREATE POLICY "Insert anónimo en solicitudes_combustible"
      ON solicitudes_combustible FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'solicitudes_combustible' AND policyname = 'Select anónimo en solicitudes_combustible'
  ) THEN
    CREATE POLICY "Select anónimo en solicitudes_combustible"
      ON solicitudes_combustible FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  -- Auditoría: solo lectura desde la app. Los inserts los hacen
  -- funciones SECURITY DEFINER (dueño postgres, exento de RLS).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'solicitudes_combustible_auditoria' AND policyname = 'Select anónimo en auditoría solicitudes'
  ) THEN
    CREATE POLICY "Select anónimo en auditoría solicitudes"
      ON solicitudes_combustible_auditoria FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notificaciones' AND policyname = 'Select anónimo en notificaciones'
  ) THEN
    CREATE POLICY "Select anónimo en notificaciones"
      ON notificaciones FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  -- Permitir marcar notificaciones como leídas (única columna con GRANT de UPDATE)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notificaciones' AND policyname = 'Update leida en notificaciones'
  ) THEN
    CREATE POLICY "Update leida en notificaciones"
      ON notificaciones FOR UPDATE
      TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  -- solicitudes_combustible_folios: sin policies => inaccesible
  -- para anon/authenticated; solo lo escribe el trigger DEFINER.
END;
$$;

-- =========================================================
-- GRANTS
-- =========================================================
GRANT SELECT, INSERT ON solicitudes_combustible TO anon, authenticated;
GRANT ALL ON solicitudes_combustible TO service_role;

GRANT SELECT ON solicitudes_combustible_auditoria TO anon, authenticated;
GRANT ALL ON solicitudes_combustible_auditoria TO service_role;

GRANT SELECT ON notificaciones TO anon, authenticated;
GRANT UPDATE (leida) ON notificaciones TO anon, authenticated;
GRANT ALL ON notificaciones TO service_role;

GRANT ALL ON solicitudes_combustible_folios TO service_role;

GRANT SELECT ON v_solicitudes_combustible_resumen TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION autorizar_solicitud_combustible(UUID, TEXT, NUMERIC, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION rechazar_solicitud_combustible(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancelar_solicitud_combustible(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION registrar_carga_edenred(UUID, TEXT, NUMERIC, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION actualizar_evidencia_edenred(UUID, TEXT, TEXT) TO anon, authenticated, service_role;

-- =========================================================
-- STORAGE: bucket público "edenred" para evidencias de carga
-- (mismo modelo que los buckets "recorridos" y "cargas_gasolina")
-- =========================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('edenred', 'edenred', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Upload anónimo evidencias edenred'
  ) THEN
    CREATE POLICY "Upload anónimo evidencias edenred"
      ON storage.objects FOR INSERT
      TO anon, authenticated
      WITH CHECK (bucket_id = 'edenred');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Lectura pública evidencias edenred'
  ) THEN
    CREATE POLICY "Lectura pública evidencias edenred"
      ON storage.objects FOR SELECT
      TO anon, authenticated
      USING (bucket_id = 'edenred');
  END IF;
END;
$$;
