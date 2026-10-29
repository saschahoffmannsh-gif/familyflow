// Bilder clientseitig verkleinern (JPEG) und grob auf dunkel/unscharf prüfen.
export type PreparedImage = { id: string; name: string; blob: Blob; url: string; base64: string; mime: 'image/jpeg'; width: number; height: number; quality: 'ok' | 'dark' | 'blurry' }
export const MAX_SIDE = 1600

/** Mittlere Helligkeit (0–255) und Schärfe (Varianz des Laplace-Filters) aus Graustufen-Pixeln. */
export function analyzeGray(gray: Uint8ClampedArray | number[], width: number, height: number) {
  let sum = 0
  for (let i = 0; i < gray.length; i++) sum += gray[i]
  const mean = gray.length ? sum / gray.length : 0
  let lsum = 0, lsq = 0, n = 0
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x
    const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]
    lsum += l; lsq += l * l; n++
  }
  const sharpness = n ? lsq / n - (lsum / n) ** 2 : 0
  return { mean, sharpness }
}
export function judgeQuality({ mean, sharpness }: { mean: number; sharpness: number }): PreparedImage['quality'] {
  if (mean < 55) return 'dark'
  if (sharpness < 60) return 'blurry'
  return 'ok'
}

const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(r.error); r.readAsDataURL(blob) })

export async function prepareImage(file: File): Promise<PreparedImage> {
  let source: ImageBitmap | HTMLImageElement
  try { source = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions) }
  catch {
    source = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Dieses Bild kann nicht gelesen werden.')); img.src = URL.createObjectURL(file) })
  }
  const w0 = 'naturalWidth' in source ? source.naturalWidth : source.width, h0 = 'naturalHeight' in source ? source.naturalHeight : source.height
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0))
  const width = Math.max(1, Math.round(w0 * scale)), height = Math.max(1, Math.round(h0 * scale))
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(source, 0, 0, width, height)
  // Qualität auf kleiner Kopie messen
  const aw = Math.min(320, width), ah = Math.max(1, Math.round(height * aw / width))
  const a = document.createElement('canvas'); a.width = aw; a.height = ah
  const actx = a.getContext('2d')!; actx.drawImage(canvas, 0, 0, aw, ah)
  const px = actx.getImageData(0, 0, aw, ah).data, gray = new Uint8ClampedArray(aw * ah)
  for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]
  const quality = judgeQuality(analyzeGray(gray, aw, ah))
  if ('close' in source) source.close()
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Bild konnte nicht verkleinert werden.')), 'image/jpeg', 0.82))
  return { id: crypto.randomUUID(), name: (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg', blob, url: URL.createObjectURL(blob), base64: await toBase64(blob), mime: 'image/jpeg', width, height, quality }
}
