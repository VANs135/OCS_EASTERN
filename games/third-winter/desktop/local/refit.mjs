import { airbaseActiveCapacity, airbaseRefitCapacity } from '@ocs-eastern/series/airbase'
import { scorpionHexId } from '../../src/import/hex-id.ts'
import { scorpionSpPayment } from '../../src/match/scorpion-sp-payment.ts'

// Aircraft refit draft: the window only forwards clicks, this module owns what a click means.
// Rule numbers stay advisory here; scorpion-refit.ts stays the only authority that charges.

function canonicalHex(hex) {
  try { return scorpionHexId(hex) } catch { return String(hex) }
}

export const sameBase = (left, right) => Boolean(left && right) &&
  left.kind === right.kind && (left.kind === 'off-map-air' || canonicalHex(left.hex) === canonicalHex(right.hex))

/** A left click opens the draft only on a friendly airfield hex or the viewer's own air box. */
export function refitBaseAt(state, side, { hex, box } = {}) {
  if (box) return { kind: 'off-map-air' }
  if (!hex || state?.kind !== 'playing') return undefined
  const at = canonicalHex(hex)
  const field = (state.airBases ?? []).find((candidate) => candidate.side === side && canonicalHex(candidate.hex) === at)
  return field ? { kind: 'hex', hex: at } : undefined
}

/** The draft base an aircraft belongs to, or undefined when it is parked somewhere that cannot refit. */
export function refitBaseOf(state, side, piece) {
  if (piece?.kind !== 'aircraft' || piece.side !== side) return undefined
  if (piece.location?.kind === 'off-map-air') return { kind: 'off-map-air' }
  if (piece.location?.kind !== 'hex') return undefined
  return refitBaseAt(state, side, { hex: piece.location.hex })
}

/** The aircraft the rule layer could ever accept for this base: own side, same base, not removed. */
export function refitAircraftAt(state, side, base) {
  if (!base) return []
  const at = base.kind === 'hex' ? canonicalHex(base.hex) : undefined
  return (state.pieces ?? []).filter((piece) => piece.kind === 'aircraft' && piece.side === side &&
    (base.kind === 'off-map-air' ? piece.location.kind === 'off-map-air'
      : piece.location.kind === 'hex' && canonicalHex(piece.location.hex) === at))
}

export const refitInactiveAt = (state, side, base) => refitAircraftAt(state, side, base).filter((piece) => !piece.active)

/**
 * What the panel shows before the player confirms: the base, the aircraft it may list, how many may
 * join this phase, the payable sources, and the single-token total for the whole batch.
 */
export function refitDraft(state, side, base, unitIds, data) {
  if (!base) return null
  const based = refitAircraftAt(state, side, base)
  const inactive = based.filter((piece) => !piece.active)
  const selected = [...new Set((unitIds ?? []).filter((id) => inactive.some((piece) => piece.id === id)))]
  const active = based.length - inactive.length
  const notes = []
  const payments = []
  let level = 0
  let limit = inactive.length
  let fenced = false
  if (base.kind === 'hex') {
    const field = (state.airBases ?? []).find((candidate) => candidate.side === side && canonicalHex(candidate.hex) === canonicalHex(base.hex))
    if (!field) return null
    level = field.level
    if (state.refittedAirbases?.includes(field.hex)) {
      notes.push('同一阶段每个机场只能整备一次，此机场本阶段已整备')
      fenced = true
    }
    const thaw = state.turn.weather.ground === 'thaw'
    const rate = airbaseRefitCapacity(field.level) / (thaw ? 2 : 1)
    const room = Math.max(0, airbaseActiveCapacity(field.level) - active)
    limit = Math.min(rate, room)
    if (thaw) notes.push(`解冻：整备速率减半，本阶段最多 ${rate} 架`)
    if (room < rate) notes.push(`激活容量 ${airbaseActiveCapacity(field.level)}：已激活 ${active} 架，最多再整备 ${room} 架`)
    const ledger = scorpionSpPayment(state, side, data.assets.map, data.board?.supplyRail)
    if (ledger.position.unnegatedEnemyZoc.has(field.hex)) {
      notes.push('机场位于未抵消的敌控制区，不能整备')
      fenced = true
    } else for (const [dumpId, dump] of Object.entries(state.dumps ?? {})) {
      if (dump.side === side && dump.location === 'on-map' && dump.tokens &&
        ledger.network.canUseDump(field.hex, dumpId.split(':').at(-1))) payments.push({ dumpId, tokens: dump.tokens })
    }
    if (!fenced && !payments.length) notes.push('没有能为本机场付款的补给堆')
  }
  const total = base.kind === 'off-map-air' ? '0T' : '1T'
  const ready = !fenced && selected.length >= 1 && selected.length <= limit &&
    (base.kind === 'off-map-air' || payments.length > 0)
  const baseLabel = base.kind === 'off-map-air' ? '地图外空军盒' : `${base.hex} 机场${level ? `（${level} 级）` : ''}`
  return { base, baseLabel, level, based, inactive, selected, active, limit, payments, notes, total, fenced, ready }
}

/** Labels for the confirm choice, so the player reads the batch and its price before submitting. */
export function refitChoiceLabels(draft) {
  if (!draft?.ready) return []
  const ids = draft.selected
  const count = `${ids.length} 架`
  if (draft.base.kind === 'off-map-air') {
    return [{ label: `免费整备 ${count}（合计 ${draft.total}）`, unitIds: ids, base: { kind: 'off-map-air' } }]
  }
  return draft.payments.map(({ dumpId }) => ({
    label: `整备 ${count} · ${dumpId.split(':').at(-1)} 支付 ${draft.total}`,
    unitIds: ids, base: { kind: 'hex', hex: draft.base.hex, dumpId },
  }))
}

export function toggleRefitSelection(state, side, base, unitIds, unitId) {
  const allowed = refitInactiveAt(state, side, base).map((piece) => piece.id)
  if (!allowed.includes(unitId)) throw new Error('请选择该基地本方非激活飞机')
  const current = (unitIds ?? []).filter((id) => allowed.includes(id))
  return current.includes(unitId) ? current.filter((id) => id !== unitId) : [...current, unitId]
}
