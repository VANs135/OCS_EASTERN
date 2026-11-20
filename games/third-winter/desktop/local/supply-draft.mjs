import { scorpionSpPayment } from '../../src/match/scorpion-sp-payment.ts'
import { hasTrace } from '../../src/match/scorpion-supply-phase.ts'
import { remainingSteps } from '../../src/match/scorpion-losses.ts'

export function supplyDraft(state, side, ids, { assets, board }) {
  const window = state.supply
  if (!window || side !== state.cursor.phasing || ids.length === 0) return null
  const name = (id) => assets.catalog.definitions.get(state.units[id]?.definition)?.source.name ?? id
  const selected = [...new Set(ids)].filter((id) => state.units[id]?.combat && state.units[id].side === side)
  if (!selected.length) return null
  const unresolved = selected.filter((id) => !window.fed.includes(id) && !hasTrace(window, id))
  const lines = selected.map((id) => `${name(id)} · ${traceStatus(window, id, name)}`)
  const choices = []
  if (!unresolved.length || window.attrition || window.splits.some(({ selected }) => !selected)) return { lines, choices }
  const portions = unresolved.map((unitId) => ({ unitId, re: remainingSteps(state.units[unitId]) }))
  const total = portions.reduce((sum, { re }) => sum + re, 0)
  const cost = Math.ceil(total / 2)
  const ledger = scorpionSpPayment(state, side, assets.map, board?.supplyRail)
  for (const { dumpId, tokens } of ledger.available(unresolved.map((id) => state.units[id]))) {
    if (tokens < cost) continue
    const { hex, truck } = ledger.source(dumpId)
    const place = truck ? `${hex} ${name(dumpId)} 车载补给` : `${hex} 补给堆`
    choices.push({
      label: `${place} · 支付 ${cost}T 供养 ${portions.length} 枚（${total} RE，余 ${tokens - cost}T）`,
      action: { type: 'feed-units', payments: [{ dumpId, portions }] },
    })
  }
  if (!choices.length) lines.push('选中待补单位没有可共同支付的具象补给来源。可分组选取。')
  return { lines, choices }
}

function traceStatus(window, id, name) {
  if (window.fed.includes(id)) return '本阶段已领取具象补给'
  if (window.traceExempt?.includes(id)) return '本回合免追溯'
  const split = window.splits.find(({ members }) => members.includes(id))
  if (split && !split.selected) return '等待选择编队的抽象补给来源'
  if (!hasTrace(window, id)) return '无法追溯抽象补给'
  const routes = window.trace[id].filter(({ kind, source, headquarters, from }) => !split ||
    split.selected === (kind === 'direct' ? `direct:${source}` : `hq:${headquarters ?? from}`))
  const labels = routes.map(({ kind, source, headquarters, from }) => kind === 'direct' ? source :
    `${source}（由 ${headquarters ? name(headquarters) : from} 投送）`)
  return `抽象补给 · ${[...new Set(labels)].join('、')}`
}
