import { ScorpionRetreatLossChoice, ScorpionRetreatRemnantChoice, scorpionRetreatBreakdownChoices } from '../../src/match/scorpion-retreat.ts'

export function retreatBreakdownOrders(units, choices) {
  const orders = units.flatMap((parentId) => choices?.[parentId]?.length ? [{ parentId, definitions: choices[parentId] }] : [])
  return orders.length ? orders : undefined
}

export function editRetreatBreakdowns(state, side, assets, steps, survivors, action, draft, validate, add) {
  if (!assets.breakdowns || !action.retreats.length) return
  const units = { ...state.units }
  const eligible = (id) => survivors[id] === undefined || survivors[id] > 0
  for (const [id, before] of Object.entries(steps)) {
    units[id] = { ...units[id], stepsLost: units[id].stepsLost + before - survivors[id] }
  }
  const preview = { ...state, units }
  const nameOf = (definition) => assets.catalog.definitions.get(definition)?.source.name ?? definition
  for (const route of action.retreats) {
    const key = route.group
    const ids = route.units.filter(eligible)
    const origin = units[ids[0]]?.hex
    if (!origin) continue
    const { [key]: _losses, ...zoc } = draft.zoc ?? {}
    const { [key]: _placement, ...retreatRemnants } = draft.retreatRemnants ?? {}
    const changed = (parentId, definitions) => ({ ...draft, zoc, retreatRemnants,
      breakdowns: { ...draft.breakdowns, [parentId]: definitions } })
    for (const parentId of ids) if (draft.breakdowns?.[parentId]?.length) {
      add(`撤销 ${nameOf(units[parentId].definition)} 的拆分`, changed(parentId, []))
    }
    for (const { parentId, definitions: [definition] } of scorpionRetreatBreakdownChoices(preview, side,
      { ...route, units: ids, origin }, assets)) {
      const next = changed(parentId, [...(draft.breakdowns?.[parentId] ?? []), definition])
      const retreats = action.retreats.map((entry) => entry === route ? { ...entry, zocLosses: undefined, remnantHexes: undefined,
        breakdowns: retreatBreakdownOrders(entry.units, next.breakdowns) } : entry)
      try { validate({ ...action, retreats }) } catch (error) {
        if (!(error instanceof ScorpionRetreatLossChoice || error instanceof ScorpionRetreatRemnantChoice)) continue
      }
      add(`${nameOf(units[parentId].definition)} 撤退前拆出 ${nameOf(definition)}`, next)
    }
  }
}
