interface Rectangle { x: number; y: number; w: number; h: number }
interface CalibratedBox extends Rectangle { label?: string }

export interface SurfaceLayout {
  width: number
  height: number
  boxes: ReadonlyMap<number, CalibratedBox>
}

interface Viewport { tx: number; ty: number; zoom: number }
type Calibration = ({ version: 3; config: Viewport } | { version: 4; global: Viewport }) & {
  background: { naturalWidth: number; naturalHeight: number; screenRect: Rectangle }
  boxes: readonly (CalibratedBox & { id: number })[]
}

/** Use the calibrator's saved viewport and background rectangle to recover native artwork pixels. */
export function calibratedSurface(source: Calibration): SurfaceLayout {
  const { version, background, boxes } = source
  if (version !== 3 && version !== 4) throw new Error('Invalid surface calibration version')
  const { tx, ty, zoom } = version === 3 ? source.config : source.global
  const { naturalWidth: width, naturalHeight: height, screenRect } = background
  if (!Array.isArray(boxes) || ![tx, ty, screenRect.x, screenRect.y].every(Number.isFinite) ||
    ![width, height, screenRect.w, screenRect.h, zoom].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error('Invalid surface calibration')
  }
  const scaleX = width / screenRect.w
  const scaleY = height / screenRect.h
  const byId = new Map<number, CalibratedBox>()
  for (const { id, x, y, w, h, label } of boxes) {
    if (!Number.isSafeInteger(id) || byId.has(id) || ![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
      throw new Error(`Invalid calibrated box ${id}`)
    }
    byId.set(id, { x: (x * zoom + tx - screenRect.x) * scaleX, y: (y * zoom + ty - screenRect.y) * scaleY,
      w: w * zoom * scaleX, h: h * zoom * scaleY, ...(label ? { label } : {}) })
  }
  return { width, height, boxes: byId }
}
