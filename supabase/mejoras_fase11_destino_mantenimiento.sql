-- =========================================================
-- MEJORAS FASE 11: DESTINO "MANTENIMIENTO" EN RECORRIDOS
-- =========================================================
-- Ejecutar en el SQL editor de Supabase.
--
-- Problema que resuelve: cuando una unidad entra a mantenimiento
-- a media ruta (ver mejoras_fase10_ingreso_excepcional.sql), no
-- se conoce el km real de ingreso y hay que dejarlo en NULL o
-- estimarlo por tiempo. Para que ese km sea confiable desde el
-- inicio, se agrega "Mantenimiento" como destino normal: si el
-- conductor registra la salida hacia el taller con ese destino,
-- el km_salida de ese recorrido queda disponible como referencia
-- automática (no exacta, pero suficiente según el encargado de
-- los vehículos) al momento de ingresar la unidad a mantenimiento.
-- =========================================================

ALTER TABLE centros_costo
  ADD COLUMN IF NOT EXISTS es_destino_mantenimiento BOOLEAN NOT NULL DEFAULT FALSE;

-- Inserta el destino especial una sola vez (idempotente): si ya existe
-- algún centro de costo marcado como destino de mantenimiento, no hace nada.
INSERT INTO centros_costo (codigo, nombre, estado, origen, es_eventual, es_destino_mantenimiento, observaciones)
SELECT
  'MANTENIMIENTO',
  'Mantenimiento',
  'activo',
  'catalogo',
  FALSE,
  TRUE,
  'Destino especial: la unidad se dirige al taller. Su km_salida sirve como referencia automática del km de ingreso a mantenimiento.'
WHERE NOT EXISTS (
  SELECT 1 FROM centros_costo WHERE es_destino_mantenimiento = TRUE
);
