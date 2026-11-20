import { scorpionHexDistance } from '../../src/import/hex-id.ts'
import { validateCombatLossOrder } from '../../src/match/scorpion-combat-losses.ts'
import { remainingSteps } from '../../src/match/scorpion-losses.ts'
import { ScorpionRemnantChoice } from '../../src/match/scorpion-remnants.ts'
import { ScorpionRetreatLossChoice, ScorpionRetreatRemnantChoice, scorpionRetreatPathOptions } from '../../src/match/scorpion-retreat.ts'

// Draft keys are retreat-stack keys, not origin hexes: several stacks may leave one hex. The first
// stack of an origin keeps the plain hex as its key, so a single-stack retreat behaves exactly as
// before (paths[origin], '撤销 <origin> 路线最后一格', and so on).

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
  const survivors = distance > 0 ? ids.filter((id) => remaining[id] > 0 && Object.hasOwn(state.units, id)) : []
  const stacks = retreatStacks(state, side, survivors, draft)
  const complete = ({ path, origin }) => path.length > 0 && scorpionHexDistance(origin, path.at(-1)) === distance
  const focus = stacks.find((stack) => stack.key === draft?.origin && !complete(stack)) ?? stacks.find((stack) => !complete(stack))
  const paths = stacks.filter(({ path }) => path.length).map(({ origin, path }) => [origin, ...path])
  const diagram = { choices, targets, paths }

  // Same origin, several stacks: the player splits or merges the group and then routes each one.
  for (const origin of new Set(survivors.map((id) => state.units[id].hex))) {
    const here = stacks.filter((stack) => stack.origin === origin)
    const members = here.flatMap(({ combat }) => combat)
    const alone = here.flatMap(({ combat, trucks }) => [...combat, ...trucks])
    if (alone.length < 2) continue
    if (here.length > 1) add(`合并 ${origin} 的撤退堆叠`, { ...change, splits: dropSplit(draft?.splits, origin) })
    if (members.length < 2) continue // A lone counter has nothing to split away from.
    for (const id of members) {
      add(`拆出 ${name(id)} 单独成组 · ${origin}`, splitOff(draft, origin, members, id), { mapUnit: id })
    }
  }
  for (const stack of stacks) {
    if (stack.path.length) add(`撤销 ${stack.key} 路线最后一格`, editPath(change, stack.key, stack.path.slice(0, -1)))
    if (!complete(stack) && stack !== focus) add(`改选 ${stack.key} 的撤退路线`, { ...change, origin: stack.key })
  }
  // Organic trucks ride with a stack only when that stack has a combat unit of the same formation,
  // which is also what the rule layer checks.
  for (const stack of stacks) {
    if (!stack.combat.length && stack.trucks.length) continue
    const loaded = trucksAt(state, side, stack.origin).filter(({ id }) => !stack.trucks.includes(id) &&
      stack.combat.some((other) => state.units[other]?.formation && state.units[other].formation === state.units[id]?.formation))
    for (const { id, formation } of loaded) {
      add(`让编内卡车 ${name(id)} 随 ${stack.key} 撤退 · ${formation}`, rideTruck(change, stack.key, stack.origin, stack.trucks, id, true))
    }
  }
  if (focus) {
    const { key, origin, path } = focus
    for (const to of scorpionRetreatPathOptions(state, side, { origin, path, units: [...focus.combat, ...focus.trucks] }, battle, assets)) {
      add(`撤退经过 ${to}`, editPath(change, key, [...path, to]), { mapHex: to })
      targets.push(to)
    }
    return { ...diagram, prompt: `${key} · 左键逐格选路，终点须距起点 ${distance} 格` }
  }

  const retreats = stacks.map(({ key, origin, combat, trucks, path }) => ({ group: key,
    units: [...combat, ...trucks], path, zocLosses: draft?.zoc?.[key], remnantHexes: draft?.retreatRemnants?.[key] }))
  const remnants = Object.entries(draft?.remnants ?? {}).map(([divisionId, hex]) => ({ divisionId, hex }))
  const action = { type: 'resolve-combat', ...mode, lossOrder, retreats, remnants }
  try {
    validate(action)
  } catch (error) {
    if (error instanceof ScorpionRetreatLossChoice) {
      const key = error.group ?? error.origin
      for (const id of error.candidates) add(`${name(id)} 损失一步`, {
        ...change, zoc: writeStep(draft?.zoc, key, error.step, id),
      }, { mapUnit: id })
      return { ...diagram, prompt: `${error.hex} · 进入敌方控制区，选一枚已混乱的单位扣一步` }
    }
    if (error instanceof ScorpionRemnantChoice) {
      const key = error instanceof ScorpionRetreatRemnantChoice && error.group ? error.group : error.origin
      for (const to of error.candidates) {
        const placement = error instanceof ScorpionRetreatRemnantChoice ?
          { retreatRemnants: writeStep(draft?.retreatRemnants, key, error.step, to) } :
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

/**
 * The retreat stacks the player has built. Each stack carries its key, its origin, the combat
 * counters in it, the organic trucks riding along, and the path drafted so far.
 */
export function retreatStacks(state, side, survivors, draft) {
  const byOrigin = new Map()
  for (const id of survivors) {
    const origin = state.units[id].hex
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), id])
  }
  return [...byOrigin].flatMap(([origin, members]) => {
    const split = draft?.splits?.[origin]
    const partitions = split && split.length ? split : [members]
    return partitions.map((combat, index) => {
      const key = stackKey(origin, index)
      return { key, origin, combat,
        trucks: (draft?.trucks?.[key] ?? []).filter((id) => Object.hasOwn(state.units, id)),
        path: draft?.paths?.[key] ?? [] }
    })
  })
}

/** The first stack of a hex is keyed by the hex itself, so an unsplit retreat keeps its old draft keys. */
export function stackKey(origin, index) {
  return index === 0 ? origin : `${origin}#${index}`
}

const trucksAt = (state, side, origin) => Object.entries(state.units)
  .filter(([, unit]) => unit.side === side && unit.combat !== true && unit.organicTruck !== undefined && unit.hex === origin)
  .map(([id, unit]) => ({ id, formation: unit.formation }))

/** Split one counter out of its origin's stack. Trucks stay with the stack they were riding. */
function splitOff(draft, origin, members, unitId) {
  const current = draft?.splits?.[origin]
  const parts = current?.length ? current.map((part) => [...part]) : [[...members]]
  const from = parts.findIndex((part) => part.includes(unitId))
  if (from < 0) return { ...draft, splits: draft?.splits }
  if (parts[from].length < 2) return { ...draft, splits: draft?.splits }
  parts[from] = parts[from].filter((id) => id !== unitId)
  parts.push([unitId])
  return { ...draft, splits: { ...draft?.splits, [origin]: parts } }
}

function dropSplit(splits, origin) {
  const { [origin]: _, ...rest } = splits ?? {}
  return Object.keys(rest).length ? rest : undefined
}

function rideTruck(draft, key, origin, current, unitId, join) {
  const trucks = join ? [...new Set([...current, unitId])] : current.filter((id) => id !== unitId)
  return { ...draft, trucks: { ...draft?.trucks, [key]: trucks } }
}

function editPath(draft, key, path) {
  return { ...draft, origin: key, paths: { ...draft?.paths, [key]: path } }
}

function writeStep(values, key, step, value) {
  return { ...values, [key]: { ...values?.[key], [step]: value } }
}
