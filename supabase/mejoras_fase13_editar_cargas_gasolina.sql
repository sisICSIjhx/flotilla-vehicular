-- =========================================================
-- MEJORAS FASE 13: EDITAR / ELIMINAR CARGAS DE GASOLINA
-- =========================================================
-- CONTEXTO:
--   cargas_gasolina tiene RLS activado con políticas solo para
--   INSERT y SELECT (anon). Sin política de UPDATE/DELETE, Supabase
--   no devuelve error: simplemente afecta 0 filas. Por eso el botón
--   "Eliminar" de /admin/cargas-gasolina podía parecer que funcionaba
--   sin borrar nada, y la nueva edición no guardaría cambios.
--
-- CAMBIOS:
--   1. Política UPDATE para anon (edición desde el panel admin).
--   2. Política DELETE para anon (botón "Eliminar esta carga").
--
-- Idempotente: se puede correr más de una vez.
-- =========================================================

DROP POLICY IF EXISTS "Update anónimo en cargas_gasolina" ON cargas_gasolina;
CREATE POLICY "Update anónimo en cargas_gasolina"
  ON cargas_gasolina
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Delete anónimo en cargas_gasolina" ON cargas_gasolina;
CREATE POLICY "Delete anónimo en cargas_gasolina"
  ON cargas_gasolina
  FOR DELETE TO anon
  USING (true);
