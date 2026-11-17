/** Campaign print and database aliases, e.g. D14.03 / D14.3. */
export function campaignHexKey(source: string): string {
  const match = /^([A-D])(\d+)\.(\d+)$/.exec(source)
  if (!match) throw new Error(`Invalid campaign hex: ${source}`)
  return `${match[1]}${Number(match[2])}.${Number(match[3])}`
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
