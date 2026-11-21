import { scorpionBreakdownChoices } from '../../src/match/scorpion-breakdowns.ts'

function departing(action) {
  return action.type === 'ground-move' ? [action.unitId] : action.unitIds
}

function applyOrders(action, orders) {
  return action.type === 'ground-move'
    ? { ...action, breakdownDefinitions: orders[0].definitions }
    : { ...action, breakdowns: orders }
}

export function breakdownDraftEntry(state, side, action, label, assets) {
  const candidates = [...scorpionBreakdownChoices(state, side, departing(action), assets)]
  if (!candidates.length) return undefined
  return { label: `选择拆分算子 · ${label}`, actions: [], breakdownDraft: { action, label, orders: [] },
    probeActions: candidates.map((order) => applyOrders(action, [order])) }
}

export function localBreakdownDraft(state, side, draft, assets, canSubmit) {
  const { action, label, orders } = draft
  const count = orders.reduce((total, { definitions }) => total + definitions.length, 0)
  const choices = [{ label: '取消拆分选择', actions: [], breakdownDraft: null }]
  const edit = (name, nextOrders) => choices.push({ label: name, actions: [], breakdownDraft: { ...draft, orders: nextOrders } })
  const counterName = (id) => assets.catalog.definitions.get(id)?.source.name ?? id
  const parents = departing(action)
  const names = (parentId, definition) => {
    const parent = state.units[parentId]
    const same = parents.filter((id) => state.units[id].definition === parent.definition && state.units[id].hex === parent.hex)
    const copy = same.length > 1 ? ` #${same.indexOf(parentId) + 1}` : ''
    return `${counterName(parent.definition)}${copy} · ${parent.hex} · ${counterName(definition)}`
  }
  for (const { parentId, definitions } of orders) {
    for (const definition of new Set(definitions)) {
      const next = [...definitions]
      next.splice(next.lastIndexOf(definition), 1)
      edit(`减一枚 · ${names(parentId, definition)}`, changeOrder(orders, parentId, next))
    }
  }
  for (const { parentId, definitions: [definition] } of scorpionBreakdownChoices(state, side, parents, assets)) {
    const selected = orders.find((order) => order.parentId === parentId)?.definitions ?? []
    const next = changeOrder(orders, parentId, [...selected, definition])
    if (!canSubmit(applyOrders(action, next))) continue
    const already = selected.filter((item) => item === definition).length
    edit(`加一枚 · ${names(parentId, definition)}${already ? ` · 已选 ${already}` : ''}`, next)
  }
  if (count) {
    const command = applyOrders(action, orders)
    if (canSubmit(command)) choices.push({ label: `确认 ${count} 枚拆分 · ${label}`, actions: [command] })
  }
  return { count, choices, prompt: `${label} · 已选 ${count} 枚拆分算子` }
}

function changeOrder(orders, parentId, definitions) {
  const index = orders.findIndex((order) => order.parentId === parentId)
  const next = [...orders]
  const replacement = definitions.length ? [{ parentId, definitions }] : []
  next.splice(index < 0 ? next.length : index, index < 0 ? 0 : 1, ...replacement)
  return next
}
