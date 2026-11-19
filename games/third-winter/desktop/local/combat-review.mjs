import { scorpionHexDistance } from '../../src/import/hex-id.ts'
import { validateCombatLossOrder } from '../../src/match/scorpion-combat-losses.ts'
import { remainingSteps } from '../../src/match/scorpion-losses.ts'
import { ScorpionRemnantChoice } from '../../src/match/scorpion-remnants.ts'
import { ScorpionRetreatLossChoice, ScorpionRetreatRemnantChoice, scorpionRetreatPathOptions } from '../../src/match/scorpion-retreat.ts'

export function localCombatReview(state, side, draft, assets, validate) {
  const battle = state.combat
  if (state.reroll || state.capture || state.airMission || state.barrage || !battle?.roll || battle.retreat ||
      !['attacker-result', 'defender-result'].includes(battle.step)) return null
  const attacking = battle.step === 'attacker-result'
  if (attacking !== (side === battle.attacker)) return null

  const result = attacking ? battle.roll.attacker : battle.roll.defender
  const ids = attacking ? battle.attackers : battle.defenders
  const leader = attacking ? battle.attackerLeader : battle.defenderLeader
  const steps = Object.fromEntries(ids.map((id) => [id, remainingSteps(state.units[id])]))
  const total = Object.values(steps).reduce((sum, value) => sum + value, 0)
  const mandatory = Math.min(result.loss, total)
  const name = (id) => assets.catalog.definitions.get(state.units[id]?.definition)?.source.name ?? id
  const mode = draft?.mode ?? (result.option === 0 ? { optionLosses: 0, ignoreDefenderOption: false } : undefined)
  const lossOrder = draft?.lossOrder ?? []
  const choices = []
  const targets = []
  const add = (label, nextDraft, target) => choices.push({ label, reviewDraft: nextDraft, ...target, actions: [] })
  if (!mode) {
    for (let paid = 0; paid <= Math.min(total - mandatory, result.option); paid++) {
      const retreat = total > mandatory + paid ? result.option - paid : 0
      const label = [paid && `承担 ${paid} 步选项损失`, retreat && `撤退 ${retreat} 格`].filter(Boolean).join('，')
      add(label || '结算战果', { mode: { optionLosses: paid, ignoreDefenderOption: false } })
    }
    if (!attacking && battle.defenderMayIgnore) add('忽略守方选项', { mode: { optionLosses: 0, ignoreDefenderOption: true } })
    return { prompt: `${battle.roll.code} · 必须损失 ${mandatory} 步，另有 ${result.option} 点选项`, choices, targets }
  }
  const needed = mandatory + mode.optionLosses
  const remaining = { ...steps }
  for (const id of lossOrder) remaining[id]--
  const change = { ...draft, mode, lossOrder }
  if (result.option) add('重选战果方案', {})
  if (lossOrder.length) add('撤销一步损失', { mode, lossOrder: lossOrder.slice(0, -1) })
  if (lossOrder.length < needed) {
    for (const id of ids) {
      const order = [...lossOrder, id]
      try { validateCombatLossOrder(state, ids, leader, order, order.length) } catch { continue }
      add(`${name(id)} 损失一步`, { mode, lossOrder: order }, { mapUnit: id })
    }
    const prompt = `${battle.roll.code} · 已分配 ${lossOrder.length}/${needed} 步`
    return { prompt, choices, targets }
  }

  const distance = total > needed && !mode.ignoreDefenderOption ? result.option - mode.optionLosses : 0
  const stacks = new Map()
  if (distance) for (const id of ids) {
    if (remaining[id] <= 0) continue
    const { hex } = state.units[id]
    stacks.set(hex, [...(stacks.get(hex) ?? []), id])
  }
  const routes = [...stacks].map(([origin, units]) => ({ origin, units, path: draft?.paths?.[origin] ?? [] }))
  const complete = ({ origin, path }) => path.length > 0 && scorpionHexDistance(origin, path.at(-1)) === distance
  const focus = routes.find((route) => route.origin === draft?.origin && !complete(route)) ?? routes.find((route) => !complete(route))
  const paths = routes.filter(({ path }) => path.length).map(({ origin, path }) => [origin, ...path])
  const diagram = { choices, targets, paths }
  for (const route of routes) {
    if (route.path.length) add(`撤销 ${route.origin} 路线最后一格`, editPath(change, route.origin, route.path.slice(0, -1)))
    if (!complete(route) && route !== focus) add(`改选 ${route.origin} 的撤退路线`, { ...change, origin: route.origin })
  }
  if (focus) {
    const { origin, path } = focus
    for (const to of scorpionRetreatPathOptions(state, side, focus, battle, assets)) {
      add(`撤退经过 ${to}`, editPath(change, origin, [...path, to]), { mapHex: to })
      targets.push(to)
    }
    return { ...diagram, prompt: `${origin} · 左键逐格选路，终点须距起点 ${distance} 格` }
  }

  const retreats = routes.map(({ origin, ...route }) => ({ ...route, zocLosses: draft?.zoc?.[origin],
    remnantHexes: draft?.retreatRemnants?.[origin] }))
  const remnants = Object.entries(draft?.remnants ?? {}).map(([divisionId, hex]) => ({ divisionId, hex }))
  const action = { type: 'resolve-combat', ...mode, lossOrder, retreats, remnants }
  try {
    validate(action)
  } catch (error) {
    if (error instanceof ScorpionRetreatLossChoice) {
      for (const id of error.candidates) add(`${name(id)} 损失一步`, {
        ...change, zoc: writeStep(draft?.zoc, error.origin, error.step, id),
      }, { mapUnit: id })
      return { ...diagram, prompt: `${error.hex} · 进入敌方控制区，选一枚已混乱的单位扣一步` }
    }
    if (error instanceof ScorpionRemnantChoice) {
      for (const to of error.candidates) {
        const placement = error instanceof ScorpionRetreatRemnantChoice ?
          { retreatRemnants: writeStep(draft?.retreatRemnants, error.origin, error.step, to) } :
          { remnants: { ...draft?.remnants, [error.division]: to } }
        add(`残部营落在 ${to}`, { ...change, ...placement }, { mapHex: to })
        targets.push(to)
      }
      return { ...diagram, prompt: `${name(error.division)} · 请选择残部营落点` }
    }
    return { ...diagram, prompt: retreats.length ? '当前战果无法结算，请调整路线或战果方案。' : error.message }
  }
  choices.push({ label: '确认战果', actions: [action] })
  return { ...diagram, prompt: `${battle.roll.code} · 待确认 ${needed} 步损失${distance ? `，撤退 ${distance} 格` : ''}` }
}

function editPath(draft, origin, path) {
  return { mode: draft.mode, lossOrder: draft.lossOrder, origin, paths: { ...draft.paths, [origin]: path } }
}

function writeStep(values, origin, step, value) {
  return { ...values, [origin]: { ...values?.[origin], [step]: value } }
}
