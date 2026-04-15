import { supabase } from '@/lib/supabase'
import { STORAGE_BUCKET } from '@/lib/constants'

export function buildFotoPath(
  vehiculoCodigo: string,
  recorridoId: string,
  tipo: 'salida' | 'regreso'
): string {
  return `vehiculos/${vehiculoCodigo}/recorridos/${recorridoId}/${tipo}.jpg`
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

export function getPublicUrl(path: string): string {
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
  return data.publicUrl
}
