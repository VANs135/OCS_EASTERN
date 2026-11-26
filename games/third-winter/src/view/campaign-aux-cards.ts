/**
 * Read-only projection joining the auxiliary-card calibration to engine state,
 * for the minimalist UI. Each calibrated box is classified into a logical role
 * and, where the state directly determines it, given its current contents or
 * active flag. Pool boxes carry the side's available counters; the UI sub-groups
 * them by the box id/definition through the catalog.
 */
import type { AuxCard } from '../import/aux-cards.ts'
import type { CampaignTurnState } from '../match/campaign-turn-state.ts'
import type { Side } from '@ocs-eastern/series/state-types'

export type AuxBoxRole = 'dead-pile' | 'rvgk' | 'breakdown-pool' | 'off-map' | 'turn-record'

export interface AuxCardBoxView {
  readonly card: string
  readonly label: string
  readonly id: string
  readonly kind: string
  readonly x: number; readonly y: number; readonly w: number; readonly h: number
  readonly side?: Side
  readonly role: AuxBoxRole
  /** RVGK box id, off-map pool name, or turn-record track name. */
  readonly section?: string
  /** Current contents (dead pile / RVGK / side available pool), when mappable. */
  readonly counterIds?: readonly string[]
  /** Turn-record track box currently in effect (weather / river). */
  readonly active?: boolean
}
export interface AuxCardView {
  readonly name: string
  readonly src: string
  readonly boxes: readonly AuxCardBoxView[]
}

const GROUND_LABEL: Readonly<Record<string, string>> = { dry: '干燥', mud: '泥泞', freeze: '冻结', thaw: '解冻' }
const FLIGHT_LABEL: Readonly<Record<string, string>> = { normal: '正常', limited: '有限', none: '禁止' }

function sideOfCard(name: string): Side | undefined {
  if (name.startsWith('Axis')) return 'axis'
  if (name.startsWith('Soviet')) return 'soviet'
  return undefined
}
function roleOf(cardName: string, kind: string): AuxBoxRole {
  if (kind === 'dead') return 'dead-pile'
  if (kind === 'RVGK') return 'rvgk'
  if (kind === 'breakdown') return 'breakdown-pool'
  if (cardName.includes('Off Map')) return 'off-map'
  return 'turn-record'
}
/** Parse "RVGK 1(Ready)" / "RVGK 2(Rebuilding)" into box id + section. */
function rvgkSection(id: string): { box: string; rebuilding: boolean } | undefined {
  const match = /^RVGK (\d+)\((Ready|Rebuilding)\)$/.exec(id)
  return match ? { box: `rvgk-${match[1]}`, rebuilding: match[2] === 'Rebuilding' } : undefined
}

function idsWhere(state: CampaignTurnState, predicate: (id: string, counter: CampaignTurnState['counters'][string]) => boolean): string[] {
  return Object.entries(state.counters).filter(([id, counter]) => predicate(id, counter)).map(([id]) => id).sort()
}

/** Project every auxiliary card against the current state. Pure; no mutation. */
export function campaignAuxCards(state: CampaignTurnState, cards: readonly AuxCard[]): readonly AuxCardView[] {
  return cards.map((card) => {
    const side = sideOfCard(card.name)
    const available = side ? idsWhere(state, (_id, c) => c.side === side && c.location.kind === 'available') : []
    const boxes = card.boxes.map((box): AuxCardBoxView => {
      const role = roleOf(card.name, box.kind)
      const base = { card: card.name, label: box.label, id: box.id, kind: box.kind,
        x: box.x, y: box.y, w: box.w, h: box.h, side, role }
      if (role === 'dead-pile') {
        return { ...base, counterIds: idsWhere(state, (_id, c) => c.side === side && c.location.kind === 'dead-pile') }
      }
      if (role === 'rvgk') {
        const parsed = rvgkSection(box.id)
        if (!parsed) return { ...base }
        return { ...base, section: parsed.box,
          counterIds: idsWhere(state, (_id, c) => c.side === side && c.location.kind === 'box' && c.location.box === parsed.box
            && ((c.stepsLost ?? 0) > 0) === parsed.rebuilding) }
      }
      if (role === 'breakdown-pool' || role === 'off-map') {
        return { ...base, section: box.id, counterIds: available }
      }
      // turn-record: highlight the weather / river track box currently in effect.
      if (box.kind === 'Ground Condition') return { ...base, section: box.kind, active: GROUND_LABEL[state.weather?.ground ?? ''] === box.id }
      if (box.kind === 'Flight Condition') return { ...base, section: box.kind, active: FLIGHT_LABEL[state.weather?.flight ?? ''] === box.id }
      if (box.kind === 'Dnepr River Condition') return { ...base, section: box.kind, active: (state.weatherHistory?.ice ? '冰封' : '正常') === box.id }
      return { ...base, section: box.kind }
    })
    return { name: card.name, src: card.src, boxes }
  })
}