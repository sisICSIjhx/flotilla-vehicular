import { supabase } from '@/lib/supabase'
import { STORAGE_BUCKET } from '@/lib/constants'

const CARGAS_BUCKET = 'cargas_gasolina'

export function buildFotoPath(
  vehiculoCodigo: string,
  recorridoId: string,
  tipo: 'salida' | 'regreso'
): string {
  return `vehiculos/${vehiculoCodigo}/recorridos/${recorridoId}/${tipo}.jpg`
}

export function buildFotoParadaPath(
  vehiculoCodigo: string,
  recorridoId: string,
  orden: number
): string {
  return `vehiculos/${vehiculoCodigo}/recorridos/${recorridoId}/parada_${orden}.jpg`
}

export function buildFotoMantenimientoPath(
  vehiculoCodigo: string,
  mantenimientoId: string
): string {
  return `vehiculos/${vehiculoCodigo}/mantenimientos/${mantenimientoId}/factura.jpg`
}

export function buildFotoRefaccionPath(
  vehiculoCodigo: string,
  refaccionId: string
): string {
  return `vehiculos/${vehiculoCodigo}/refacciones/${refaccionId}/factura.jpg`
}

export function buildFotoCargaPath(
  vehiculoCodigo: string,
  cargaId: string,
  tipo: 'tablero_antes' | 'tablero_despues' | 'ticket'
): string {
  return `vehiculos/${vehiculoCodigo}/cargas/${cargaId}/${tipo}.jpg`
}

export async function subirFoto(path: string, file: File): Promise<string> {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { contentType: 'image/jpeg', upsert: false })

  if (error) throw new Error(`Error al subir foto: ${error.message}`)

  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(data.path)

  return urlData.publicUrl
}

export async function subirFotoCarga(path: string, file: File): Promise<string> {
  const { data, error } = await supabase.storage
    .from(CARGAS_BUCKET)
    .upload(path, file, { contentType: 'image/jpeg', upsert: false })

  if (error) throw new Error(`Error al subir foto de carga: ${error.message}`)

  const { data: urlData } = supabase.storage
    .from(CARGAS_BUCKET)
    .getPublicUrl(data.path)

  return urlData.publicUrl
}

export function getPublicUrl(path: string): string {
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export function getPublicUrlCarga(path: string): string {
  const { data } = supabase.storage.from(CARGAS_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

// ── Evidencias de carga Edenred ────────────────────────────
const EDENRED_BUCKET = 'edenred'

export function buildEvidenciaEdenredPath(solicitudId: string): string {
  return `solicitudes/${solicitudId}/evidencia_${Date.now()}.jpg`
}

export async function subirEvidenciaEdenred(path: string, file: File): Promise<string> {
  const { data, error } = await supabase.storage
    .from(EDENRED_BUCKET)
    .upload(path, file, { contentType: 'image/jpeg', upsert: false })

  if (error) throw new Error(`Error al subir evidencia: ${error.message}`)

  const { data: urlData } = supabase.storage
    .from(EDENRED_BUCKET)
    .getPublicUrl(data.path)

  return urlData.publicUrl
}

export function getPublicUrlEdenred(path: string): string {
  const { data } = supabase.storage.from(EDENRED_BUCKET).getPublicUrl(path)
  return data.publicUrl
}
