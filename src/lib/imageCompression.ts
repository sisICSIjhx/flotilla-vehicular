import imageCompression from 'browser-image-compression'

export async function comprimirFoto(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: 0.3,
    maxWidthOrHeight: 1280,
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: 0.7,
  })
}
