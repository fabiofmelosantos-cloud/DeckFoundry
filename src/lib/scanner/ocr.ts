import type { Worker } from 'tesseract.js'

// On-device OCR for card scanning (Tesseract, WebAssembly). Two small regions
// of a framed card are read: the title line and the collector line in the
// bottom-left corner ("0146 R" / "M15 • EN"). Nothing leaves the phone.

let worker: Promise<Worker> | null = null

/** Lazily starts the OCR worker (engine + English model are fetched once and cached). */
export function ocrWorker(): Promise<Worker> {
  worker ??= import('tesseract.js').then(({ createWorker }) => createWorker('eng'))
  return worker
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// Where things are on a card, as fractions of the card rectangle. Generous
// margins absorb a card that isn't perfectly inside the guide frame.
export const REGIONS = {
  title: { x: 0.04, y: 0.025, w: 0.74, h: 0.085 },
  info: { x: 0.02, y: 0.885, w: 0.6, h: 0.1 },
}

/**
 * Crops a region of `source` (inside the card rect) into a canvas scaled so the
 * text is ~40px tall, greyscale and contrast-stretched — Tesseract reads that best.
 */
export function prepare(source: CanvasImageSource, card: Rect, region: Rect, targetHeight: number, invertMode: 'auto' | 'yes' | 'no' = 'auto'): HTMLCanvasElement {
  const sx = card.x + region.x * card.w
  const sy = card.y + region.y * card.h
  const sw = region.w * card.w
  const sh = region.h * card.h
  const scale = Math.max(1, targetHeight / sh)
  const c = document.createElement('canvas')
  c.width = Math.round(sw * scale)
  c.height = Math.round(sh * scale)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height)
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  // Greyscale + contrast stretch (1st–99th percentile)
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
    d[i] = g
    hist[g]++
  }
  const total = d.length / 4
  let lo = 0
  let hi = 255
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.01; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.01; hi--);
  const span = Math.max(1, hi - lo)
  // Card text is light on dark frames (bottom line) or dark on light (title bar):
  // normalise to dark text on white using the region's average brightness.
  let sum = 0
  for (let i = 0; i < d.length; i += 4) sum += d[i]
  const invert = invertMode === 'auto' ? sum / total < 110 : invertMode === 'yes'
  for (let i = 0; i < d.length; i += 4) {
    let v = ((d[i] - lo) * 255) / span
    v = Math.max(0, Math.min(255, v))
    if (invert) v = 255 - v
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return c
}

export async function readRegion(canvas: HTMLCanvasElement, kind: 'title' | 'info' | 'sparse'): Promise<{ text: string; confidence: number }> {
  const w = await ocrWorker()
  await w.setParameters(
    kind === 'info'
      ? { tessedit_pageseg_mode: '6' as never, tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/•*·.- ' }
      : { tessedit_pageseg_mode: (kind === 'sparse' ? '6' : '7') as never, tessedit_char_whitelist: '' },
  )
  const { data } = await w.recognize(canvas)
  return { text: data.text.trim(), confidence: data.confidence }
}

/**
 * Extra readings of the title for cards without a collector line (pre-2014):
 * inverted colours (white titles on dark frames), a noise-tolerant mode, and a
 * crop nudged down past textured frame borders. Only used when needed — it's slower.
 */
export async function titleVariants(src: CanvasImageSource, card: Rect): Promise<string[]> {
  const lower = { ...REGIONS.title, y: REGIONS.title.y + 0.012, h: REGIONS.title.h - 0.012 }
  const out: string[] = []
  for (const [region, invert, kind] of [
    [lower, 'auto', 'title'],
    [REGIONS.title, 'yes', 'title'],
    [lower, 'yes', 'title'],
    [REGIONS.title, 'auto', 'sparse'],
  ] as [Rect, 'auto' | 'yes', 'title' | 'sparse'][]) {
    const { text } = await readRegion(prepare(src, card, region, 96, invert), kind)
    // sparse mode returns several fragments; keep the longest alphabetic line
    const best = text.split(/\n+/).sort((a, b) => b.replace(/[^A-Za-z]/g, '').length - a.replace(/[^A-Za-z]/g, '').length)[0] ?? ''
    if (best.trim()) out.push(best.trim())
  }
  return out
}
