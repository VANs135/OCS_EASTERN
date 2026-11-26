/**
 * Loader for the TTW auxiliary-card box calibration (辅助卡标定/*.boxes.json).
 *
 * Each play-aid card image carries a set of pixel regions ("boxes") that the UI
 * renders as clickable holding areas. This module reads the calibration into a
 * typed registry; the engine-state join lives in view/campaign-aux-cards.ts so
 * the cards stay a read-only projection for the minimalist UI.
 */
export interface AuxCardBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly id: string
  readonly label: string
  readonly kind: string
  readonly meta: Readonly<Record<string, unknown>>
}
export interface AuxCard {
  readonly name: string
  readonly src: string
  readonly boxes: readonly AuxCardBox[]
}

/** The eight TTW auxiliary cards, by calibration file stem. */
export const TTW_AUX_CARD_FILES = [
  'Axis Breakdowns', 'Axis Dead Pile ', 'Axis Off Map',
  'Soviet Breakdowns', 'Soviet Dead Pile', 'Soviet Off Map', 'Soviet RVGK', 'Turn Record b',
] as const

function requireString(row: Record<string, unknown>, field: string, where: string): string {
  const value = row[field]
  if (typeof value !== 'string' || !value) throw new Error(`${where}: ${field} must be a non-empty string`)
  return value
}
function requireNumber(row: Record<string, unknown>, field: string, where: string): number {
  const value = row[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${where}: ${field} must be a finite number`)
  return value
}

/** Read one calibration document. `readJson(stem)` returns the parsed `.boxes.json`. */
export function loadAuxCard(stem: string, readJson: (stem: string) => unknown): AuxCard {
  const raw = readJson(stem)
  if (!raw || typeof raw !== 'object') throw new Error(`aux card ${stem}: expected an object`)
  const row = raw as Record<string, unknown>
  const name = requireString(row, 'name', stem)
  const src = requireString(row, 'src', stem)
  if (!Array.isArray(row.boxes)) throw new Error(`aux card ${stem}: boxes must be an array`)
  const boxes = row.boxes.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`aux card ${stem} box ${index}: expected an object`)
    const box = entry as Record<string, unknown>
    const where = `aux card ${stem} box ${index}`
    return {
      x: requireNumber(box, 'x', where), y: requireNumber(box, 'y', where),
      w: requireNumber(box, 'w', where), h: requireNumber(box, 'h', where),
      id: requireString(box, 'id', where), label: requireString(box, 'label', where),
      kind: requireString(box, 'kind', where),
      meta: (box.meta && typeof box.meta === 'object' ? box.meta : {}) as Record<string, unknown>,
    } satisfies AuxCardBox
  })
  return { name, src, boxes }
}

/** Read every TTW auxiliary card. */
export function loadAuxCards(readJson: (stem: string) => unknown): readonly AuxCard[] {
  return TTW_AUX_CARD_FILES.map((stem) => loadAuxCard(stem, readJson))
}