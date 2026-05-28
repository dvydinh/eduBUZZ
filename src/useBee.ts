import { useEffect, useState } from 'react'
import beePng from '@/imports/image.png'

let cached: string | null = null
let pending: Promise<string> | null = null

// Remove the sticker's light backdrop by flood-filling transparency from the
// image edges inward — interior light areas (like the wings) are preserved.
function process(): Promise<string> {
  if (cached) return Promise.resolve(cached)
  if (pending) return pending

  pending = new Promise<string>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(beePng)
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, w, h)
      const px = data.data

      const isLight = (i: number) => {
        const r = px[i]
        const g = px[i + 1]
        const b = px[i + 2]
        // light & low-saturation → background / white outline
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        return min > 200 && max - min < 40
      }

      const stack: number[] = []
      const push = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return
        stack.push(y * w + x)
      }
      for (let x = 0; x < w; x++) {
        push(x, 0)
        push(x, h - 1)
      }
      for (let y = 0; y < h; y++) {
        push(0, y)
        push(w - 1, y)
      }
      const seen = new Uint8Array(w * h)
      while (stack.length) {
        const p = stack.pop()!
        if (seen[p]) continue
        seen[p] = 1
        const i = p * 4
        if (!isLight(i)) continue
        px[i + 3] = 0 // transparent
        const x = p % w
        const y = (p / w) | 0
        push(x + 1, y)
        push(x - 1, y)
        push(x, y + 1)
        push(x, y - 1)
      }

      ctx.putImageData(data, 0, 0)
      cached = canvas.toDataURL('image/png')
      resolve(cached)
    }
    img.onerror = () => resolve(beePng)
    img.src = beePng
  })
  return pending
}

export function useBee(): string {
  const [src, setSrc] = useState(cached ?? beePng)
  useEffect(() => {
    let alive = true
    process().then((s) => alive && setSrc(s))
    return () => {
      alive = false
    }
  }, [])
  return src
}
