-- =========================================================
-- MIGRACIÓN: MÓDULO CARGAS DE GASOLINA
-- Ejecutar en Supabase SQL Editor en 3 pasos
-- =========================================================

-- ============================================================
-- PASO 1: CREAR TABLA cargas_gasolina (seguro ejecutar primero)
-- ============================================================
CREATE TABLE IF NOT EXISTS cargas_gasolina (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  vehiculo_codigo   VARCHAR(20) NOT NULL,
  conductor_id      INTEGER     NOT NULL,
  recorrido_id      UUID        NULL,     -- NULL = "Fuera de recorrido"

  -- Sección A: antes de cargar
  km_antes                 INTEGER       NOT NULL,
  combustible_antes        SMALLINT      NOT NULL,
  foto_tablero_antes_path  TEXT          NULL,

  -- Sección B: después de cargar
  km_despues                INTEGER       NOT NULL,
  combustible_despues       SMALLINT      NOT NULL,
  litros_cargados           DECIMAL(10,3) NOT NULL,
  precio_litro              DECIMAL(10,3) NOT NULL,
  foto_tablero_despues_path TEXT          NULL,
  foto_ticket_path          TEXT          NULL,

  observaciones TEXT NULL,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_carga_vehiculo
    FOREIGN KEY (vehiculo_codigo) REFERENCES vehiculos(codigo),
  CONSTRAINT fk_carga_conductor
    FOREIGN KEY (conductor_id) REFERENCES conductores(id),
  CONSTRAINT fk_carga_recorrido
    FOREIGN KEY (recorrido_id) REFERENCES recorridos(id) ON DELETE SET NULL,
  CONSTRAINT check_carga_km_antes
    CHECK (km_antes >= 0),
  CONSTRAINT check_carga_km_despues
    CHECK (km_despues >= 0),
  CONSTRAINT check_carga_km_orden
    CHECK (km_despues >= km_antes),
  CONSTRAINT check_carga_combustible_antes
    CHECK (combustible_antes BETWEEN 0 AND 8),
  CONSTRAINT check_carga_combustible_despues
    CHECK (combustible_despues BETWEEN 0 AND 8),
  CONSTRAINT check_carga_litros
    CHECK (litros_cargados > 0),
  CONSTRAINT check_carga_precio
    CHECK (precio_litro > 0)
);

CREATE INDEX IF NOT EXISTS idx_cargas_vehiculo
  ON cargas_gasolina(vehiculo_codigo);
CREATE INDEX IF NOT EXISTS idx_cargas_conductor
  ON cargas_gasolina(conductor_id);
CREATE INDEX IF NOT EXISTS idx_cargas_recorrido
  ON cargas_gasolina(recorrido_id);
CREATE INDEX IF NOT EXISTS idx_cargas_fecha
  ON cargas_gasolina(created_at);
CREATE INDEX IF NOT EXISTS idx_cargas_vehiculo_fecha
  ON cargas_gasolina(vehiculo_codigo, created_at DESC);

DROP TRIGGER IF EXISTS trg_cargas_gasolina_updated_at ON cargas_gasolina;
CREATE TRIGGER trg_cargas_gasolina_updated_at
BEFORE UPDATE ON cargas_gasolina
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- PASO 2: MIGRAR DATOS HISTÓRICOS (best-effort)
-- Verificar resultados antes de continuar con el PASO 3
-- ============================================================

-- 2A: Desde cierres de recorrido con carga de combustible
INSERT INTO cargas_gasolina (
  vehiculo_codigo, conductor_id, recorrido_id,
  km_antes, km_despues,
  combustible_antes, combustible_despues,
  litros_cargados, precio_litro,
  foto_tablero_antes_path, foto_tablero_despues_path, foto_ticket_path,
  observaciones, created_at
)
SELECT
  r.vehiculo_codigo, r.conductor_id, r.id,
  r.km_salida, r.km_regreso,
  r.combustible_salida, COALESCE(r.combustible_regreso, r.combustible_salida),
  r.litros_cargados, r.precio_litro,
  r.foto_salida_path, r.foto_regreso_path, NULL,
  'MIGRADO: km_antes=km_salida, km_despues=km_regreso (aproximado). Sin foto de ticket histórica.',
  COALESCE(r.fecha_regreso, r.created_at)
FROM recorridos r
WHERE r.litros_cargados IS NOT NULL AND r.litros_cargados > 0
  AND r.precio_litro IS NOT NULL AND r.precio_litro > 0
  AND r.estado = 'cerrado' AND r.km_regreso IS NOT NULL
  AND r.foto_salida_path IS NOT NULL AND r.foto_regreso_path IS NOT NULL;

-- 2B: Desde paradas intermedias con carga de combustible
INSERT INTO cargas_gasolina (
  vehiculo_codigo, conductor_id, recorrido_id,
  km_antes, km_despues,
  combustible_antes, combustible_despues,
  litros_cargados, precio_litro,
  foto_tablero_antes_path, foto_tablero_despues_path, foto_ticket_path,
  observaciones, created_at
)
SELECT
  r.vehiculo_codigo, r.conductor_id, rp.recorrido_id,
  COALESCE(rp.km_parada, r.km_salida), COALESCE(rp.km_parada, r.km_salida),
  COALESCE(rp.combustible_parada, r.combustible_salida),
  COALESCE(rp.combustible_parada, r.combustible_salida),
  rp.litros_cargados, rp.precio_litro,
  NULL,
  NULL,
  NULL,
  'MIGRADO: Desde parada intermedia. km_antes=km_despues. Sin fotos (la foto de parada es del odómetro, no de carga).',
  COALESCE(rp.fecha_parada, r.created_at)
FROM recorridos_paradas rp
JOIN recorridos r ON r.id = rp.recorrido_id
WHERE rp.litros_cargados IS NOT NULL AND rp.litros_cargados > 0
  AND rp.precio_litro IS NOT NULL AND rp.precio_litro > 0
  AND rp.foto_parada_path IS NOT NULL;

-- Verificación: contar registros migrados
-- SELECT 'Migrados desde recorridos' AS origen, COUNT(*) FROM cargas_gasolina WHERE observaciones LIKE 'MIGRADO: Desde cierre%'
-- UNION ALL
-- SELECT 'Migrados desde paradas', COUNT(*) FROM cargas_gasolina WHERE observaciones LIKE 'MIGRADO: Desde parada%';

-- ============================================================
-- PASO 3: ELIMINAR COLUMNAS OBSOLETAS
-- EJECUTAR SOLO DESPUÉS DE VERIFICAR EL PASO 2
-- y DESPUÉS de desplegar el nuevo frontend
-- ============================================================

-- ALTER TABLE recorridos
--   DROP COLUMN IF EXISTS litros_cargados,
--   DROP COLUMN IF EXISTS precio_litro;

-- ALTER TABLE recorridos_paradas
--   DROP COLUMN IF EXISTS litros_cargados,
--   DROP COLUMN IF EXISTS precio_litro;
