/** Campaign print and database aliases, e.g. D14.03 / D14.3. */
export function campaignHexKey(source: string): string {
  const key = tryCampaignHexKey(source)
  if (!key) throw new Error(`Invalid campaign hex: ${source}`)
  return key
}

export function tryCampaignHexKey(source: string): string | undefined {
  const match = /^([A-D])(\d+)\.(\d+)$/.exec(source)
  if (match) return `${match[1]}${Number(match[2])}.${Number(match[3])}`
}

/** Scorpion program rows are inverted at row 11 (e.g. 40th Army: 1,-3 / s1.14). */
export function scorpionPrintedHex(col: number, programRow: number): string {
  return `s${col}.${String(11 - programRow).padStart(2, '0')}`
}

export function scorpionHexId(source: string): string {
  const match = /^s(\d+)\.(\d{1,2})$/i.exec(source)
  if (!match) throw new Error(`Invalid printed Scorpion hex: ${source}`)
  return `s${Number(match[1])}.${match[2]!.padStart(2, '0')}`
}

export function scorpionHexDistance(from: string, to: string): number {
  function axial(hex: string) {
    const [col, row] = scorpionHexId(hex).slice(1).split('.').map(Number)
    return [col!, row! - Math.floor((col! - 1) / 2)] as const
  }
  const [aq, ar] = axial(from)
  const [bq, br] = axial(to)
  const q = aq - bq
  const r = ar - br
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r))
}
