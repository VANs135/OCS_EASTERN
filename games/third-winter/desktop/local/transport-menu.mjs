import { assertScorpionTransportWindow, collectTransportPoints, regularTransportDefinition }
  from '../../src/match/scorpion-transport-points.ts'

export function transportMenuChoices(state, side, unitIds, { catalog }) {
  if (state.kind !== 'playing') return []
  let selected
  try {
    assertScorpionTransportWindow(state, side)
    selected = collectTransportPoints(state, side, unitIds, catalog)
  } catch { return [] }
  const first = selected[0].unit
  const points = selected.reduce((sum, row) => sum + row.points, 0)
  const tokens = selected.reduce((sum, row) => sum + row.tokens, 0)
  const denomination = (size) => regularTransportDefinition(catalog, first, size)
  const divisions = selected.length === 1
    ? splitOptions(points, tokens, denomination)
    : denomination(points) ? [[{ points, tokens }]] : []
  const active = state.groundActivity?.transport?.unitId
  const mayContinue = unitIds.includes(active) && !unitIds.some((id) => id !== active && state.moved.includes(id))
  const verb = selected.length === 1 ? '拆分' : '合并'
  return divisions.flatMap((parts) => {
    const label = `${verb} · ${parts.map(({ points, tokens }) => `${points} 点载 ${tokens}T`).join(' + ')}`
    const order = { unitIds, divisions: parts }
    if (!mayContinue) return [{ label, order }]
    return [{ label: `${label} · 结束移动`, order }, ...parts.map((_, index) =>
      ({ label: `${label} · 第 ${index + 1} 枚继续移动`, order: { ...order, continueWith: index } }))]
  })
}

function splitOptions(points, tokens, denomination) {
  const options = []
  for (let left = 1; left <= points / 2; left++) {
    const right = points - left
    if (!denomination(left) || !denomination(right)) continue
    for (let cargo = Math.max(0, tokens - right * 4); cargo <= Math.min(tokens, left * 4); cargo++) {
      if (left === right && cargo < tokens - cargo) continue
      options.push([{ points: left, tokens: cargo }, { points: right, tokens: tokens - cargo }])
    }
  }
  return options
}
