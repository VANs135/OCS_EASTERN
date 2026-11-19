import { scorpionSpPayment } from '../../src/match/scorpion-sp-payment.ts'

// Combat supply and advancement draft: the window only forwards clicks, this module owns which
// payments and which advancement batches the player may confirm. Rule numbers stay advisory here;
// scorpion-combat-supply.ts stays the only authority that charges, and scorpion-combat-result.ts
// stays the only authority that moves counters.

const LIMIT = 24
const terrainName = { Open: '开阔地', Village: '村庄', 'Minor City': '小城市', 'Major City': '大城市',
  Hills: '丘陵', Woods: '疏林', Forest: '密林', Rough: '崎岖地', Mountain: '山地', Swamp: '沼泽' }
const riverName = (value) => value.startsWith('major') ? '大河' : '小河'
const sourceName = (ledger, dumpId) => {
  const { hex, truck } = ledger.source(dumpId)
  return truck ? `${hex} 运输点` : hex
}

/** OCS 12.3 / 13.2g: a defending stack costs 2T once its total RE exceeds one, otherwise 1T. */
export function defendingStackCost(units) {
  return units.reduce((total, unit) => total + unit.printedRe - unit.stepsLost, 0) > 1 ? 2 : 1
}

/** Every source any defender could draw from, with the defenders that source can actually reach. */
function sourceRows(ledger, defenders) {
  const ids = new Set()
  for (const unit of defenders) for (const { dumpId } of ledger.available([unit], true)) ids.add(dumpId)
  return [...ids].map((dumpId) => ({ dumpId, tokens: ledger.source(dumpId).tokens,
    reached: defenders.filter((unit) => ledger.canUse(unit, dumpId)) }))
}

/** Token splits over those sources that pay the stack cost and still reach every defender. */
function combinationRows(rows, defenders, cost) {
  const needed = new Map(defenders.map((unit) => [unit, defendingStackCost([unit])]))
  const out = []
  const walk = (index, picked, total) => {
    if (out.length >= LIMIT || total > cost) return
    if (total === cost) {
      const coverage = new Map(defenders.map((unit) => [unit, 0]))
      for (const row of picked) for (const unit of row.reached) coverage.set(unit, (coverage.get(unit) ?? 0) + row.tokens)
      if (defenders.every((unit) => (coverage.get(unit) ?? 0) >= (needed.get(unit) ?? 0))) {
        out.push(picked.map(({ dumpId, tokens }) => ({ dumpId, tokens })))
      }
      return
    }
    if (index >= rows.length) return
    const row = rows[index]
    for (let tokens = Math.min(row.tokens, cost - total); tokens >= 1; tokens--) {
      walk(index + 1, [...picked, { dumpId: row.dumpId, tokens, reached: row.reached }], total + tokens)
    }
    walk(index + 1, picked, total)
  }
  walk(0, [], 0)
  return out
}

/**
 * Defenders confirm one whole-stack payment. On-map supply may combine a dump, a transport point and
 * HQ delivery; each defender must still be reachable by whatever pays for it.
 */
export function defenseSupplyDraft(state, side, data, unitIds = []) {
  const battle = state?.combat
  if (!battle || battle.step !== 'defender-supply' || side === battle.attacker) return null
  const defenders = battle.defenders.map((id) => state.units[id]).filter(Boolean)
  if (!defenders.length) return null
  const cost = defendingStackCost(defenders)
  const ledger = scorpionSpPayment(state, side, data.assets.map, data.board?.supplyRail)
  const preferred = unitIds.find((id) => battle.defenders.includes(id))
  const rows = sourceRows(ledger, defenders)
  const payments = combinationRows(rows, defenders, cost).map((split) => ({
    payments: split,
    credit: split.reduce((total, { dumpId, tokens }) => total + tokens * (dumpId === preferred ? 1e6 : 1), 0),
    label: `支付 ${cost}T · ${split.map(({ dumpId, tokens }) => `${sourceName(ledger, dumpId)} ${tokens}T`).join(' + ')}`,
  })).sort((left, right) => right.credit - left.credit)
  // OCS 12.10h: a defender draws its own stocks only when its reachable on-map supply is short.
  const short = battle.defenders.filter((id) => state.units[id]?.internalStocks !== 'exhausted' &&
    ledger.available([state.units[id]], false).reduce((total, row) => total + row.tokens, 0) < cost)
  return { cost, defenders: battle.defenders, sources: rows.map(({ dumpId }) => dumpId),
    payments: payments.slice(0, LIMIT), stockUnitIds: short }
}

/** Candidate rows for the defender's payment step, in the order the panel lists them. */
export function defenseSupplyChoices(draft) {
  if (!draft) return []
  const rows = draft.payments.map(({ label, payments }) => ({ label, type: 'defend-combat', payments, internalUnitIds: [] }))
  for (const unitId of draft.stockUnitIds) rows.push({ label: '部队储备 · 由 1 枚自付', type: 'defend-combat',
    payments: [], internalUnitIds: [unitId] })
  if (draft.stockUnitIds.length > 1) rows.push({ label: `部队储备 · 全部 ${draft.stockUnitIds.length} 枚自付`,
    type: 'defend-combat', payments: [], internalUnitIds: draft.stockUnitIds })
  rows.push({ label: '守方免付战斗补给', type: 'defend-combat', payments: [], internalUnitIds: [] })
  return rows
}

/**
 * TTW combat terrain: the defender names the printed terrain of the target hex; each attacking
 * origin separately names a terrain or the river it crosses on the way in.
 */
export function terrainDraft(state, side, data) {
  const battle = state?.combat
  if (!battle || battle.step !== 'defender-terrain' || side === battle.attacker) return null
  const { map } = data.assets
  const terrains = map.hexes.get(battle.target)?.terrains ?? []
  if (!terrains.length) return null
  const origins = [...new Set(battle.attackers.map((id) => state.units[id]?.hex).filter(Boolean))]
  const options = origins.map((from) => {
    const river = map.edge(from, battle.target)?.river
    return [from, [...terrains, ...(river ? [`${river}-river`] : [])]]
  })
  const rows = []
  const walk = (index, values) => {
    if (rows.length >= LIMIT) return
    if (index === options.length) {
      for (const terrain of terrains) {
        const attackingTerrain = Object.fromEntries(options.map(([from], at) => [from, values[at]]))
        const parts = origins.map((from, at) => `${from}→${values[at].endsWith('-river') ? riverName(values[at]) : terrainName[values[at]] ?? values[at]}`)
        rows.push({ label: `${terrainName[terrain] ?? terrain}（${parts.join('、')}）`, terrain, attackingTerrain })
      }
      return
    }
    for (const value of options[index][1]) walk(index + 1, [...values, value])
  }
  walk(0, [])
  return rows.length ? { target: battle.target, terrains, origins, rows } : null
}

export const terrainChoices = (draft) => draft ? draft.rows.map(({ label, terrain, attackingTerrain }) =>
  ({ label, type: 'choose-combat-terrain', terrain, attackingTerrain })) : []

/**
 * Advancement: the attacker ticks surviving counters. A batch is offered only while the stack that
 * would land in the target still fits the 10 RE limit that advanceScorpionCombat re-checks.
 */
export function advanceDraft(state, side) {
  const battle = state?.combat
  if (!battle || battle.step !== 'advance' || battle.attacker !== side) return null
  const survivors = battle.attackers.filter((id) => Object.hasOwn(state.units, id))
  // The step exists only once the target is clear of enemy combat units, so the ceiling is the 10 RE
  // stacking limit on the counters that move in, plus any friendly counters the hex already holds.
  const held = Object.values(state.units).filter((unit) => unit.combat && unit.hex === battle.target &&
    unit.side === side).reduce((total, unit) => total + unit.printedRe - unit.stepsLost, 0)
  const weight = (ids) => ids.reduce((total, id) => total + state.units[id].printedRe - state.units[id].stepsLost, 0)
  const fits = (ids) => held + weight(ids) <= 10
  const rows = [{ label: '放弃战后推进', unitIds: [] }]
  for (let count = survivors.length; count >= 2; count--) {
    const batch = survivors.slice(0, count)
    if (fits(batch)) { rows.push({ label: `一并推进 ${count} 枚`, unitIds: batch }); break }
  }
  for (const id of survivors) rows.push({ label: '推进 1 枚', unitIds: [id], unitId: id })
  if (survivors.length > 2) for (let index = 0; index < survivors.length && rows.length < LIMIT; index++) {
    const subset = survivors.filter((_, at) => at !== index)
    if (subset.length > 1 && fits(subset)) rows.push({ label: `推进其余 ${subset.length} 枚`, unitIds: subset })
  }
  return { target: battle.target, survivors, room: 10 - held, rows: rows.slice(0, LIMIT) }
}

export const advanceChoices = (draft, nameOf) => draft ? draft.rows.map(({ label, unitIds, unitId }) =>
  ({ label: unitId ? `${label} · ${nameOf(unitId)}` : label, type: 'advance-after-combat', unitIds })) : []
