import { localChoices, opponent } from './actions.mjs'
import { canMoveInPhase } from '../../src/match/scorpion-movement.ts'
import { hasScorpionBulkFuel } from '../../src/match/scorpion-fuel.ts'
import { carriedScorpionTokens, scorpionSpPayment } from '../../src/match/scorpion-sp-payment.ts'
import { transportPoints } from '../../src/match/scorpion-transport-points.ts'
import { remainingSteps } from '../../src/match/scorpion-losses.ts'
import { aircraftProfile } from '../../src/match/scorpion-air-bases.ts'
import { internalRecoveryPerLevel } from '@ocs-eastern/series/internal-stocks'
import { airTransportModes } from '@ocs-eastern/series/air-transport'
import { refitBaseAt, refitChoiceLabels, refitDraft } from './refit.mjs'

const movementPhases = ['movement', 'reaction', 'exploitation']
const categories = new Map([
  ['set-ground-mode', '模式'], ['mark-reserve', '预备队'], ['leave-reserve', '预备队'], ['release-reserve', '预备队'],
  ['load-transport', '运输'], ['unload-transport', '运输'], ['form-extender', '运输'], ['dismantle-extender', '运输'],
  ['fuel-formation', '加油'], ['fuel-headquarters', '加油'], ['fuel-from-paused-transport', '加油'],
  ['work-hedgehog', '工事'], ['feed-units', '补给'], ['recover-internal-stocks', '补给'], ['refit-aircraft', '飞机整备'],
  ['declare-artillery-barrage', '射击'], ['declare-front-barrage', '射击'], ['declare-combat', '地面战斗'],
  ['declare-overrun', '地面战斗'],
])
export const pointActions = new Set(['base-aircraft', 'place-setup-alert', 'place-arrival', 'place-supply', 'place-alert'])
export const moveActions = new Set(['ground-move', 'continue-overrun-move', 'reserve-stack-move'])
const keepSelection = new Set(['模式', '预备队', '运输', '加油', '工事', '补给', '飞机整备'])

export function menuGroup(action) {
  if (action.type === 'launch-air-mission') {
    if (['barrage', 'hip-shoot'].includes(action.mission)) return '射击'
    return '空军'
  }
  if (action.type === 'ground-move' && (action.fuelDumpId || action.fuelHeadquartersId)) return '加油并移动'
  return categories.get(action.type)
}

export const sidebarChoice = ({ actions }) => !menuGroup(actions[0])
export const retainCounter = (action) => keepSelection.has(menuGroup(action))

export function routeTo(state, source, target, map) {
  const unit = state.units?.[source.unitId]
  if (!unit || !movementPhases.includes(state.cursor.phase) || !canMoveInPhase(unit, state.cursor.phase)) return []
  const steps = source.route ?? []
  const from = steps.at(-1) ?? unit.hex
  if (target === unit.hex) return []
  if (target === from) return steps
  if (steps.includes(target)) return steps.slice(0, steps.indexOf(target) + 1)
  return map.neighbors(from).includes(target) ? [...steps, target] : []
}

export function actionTarget(action, destination) {
  if (destination.box) {
    return action.base?.kind === 'off-map-air' || action.target?.kind === 'air-box' || action.target?.kind === 'off-map-air'
  }
  if (!destination.hex) return false
  return action.hex === destination.hex || action.base?.hex === destination.hex ||
    action.target?.id === destination.hex || action.target?.hex === destination.hex
}

export function localMenu(state, side, selection, hit, data, choicesAt) {
  const rows = []
  const seen = new Set()
  const append = (choice, heading) => {
    const action = choice.actions[0]
    const group = menuGroup(action)
    const key = JSON.stringify(choice.actions)
    if (!group || seen.has(key)) return
    seen.add(key)
    rows.push({ ...choice, group, label: heading ? `${heading} · ${choice.label}` : choice.label })
  }
  const add = (label, type, fields) => append({ label, actions: [{ type, ...fields }] })
  const selected = selection.unitIds?.length ? selection.unitIds : selection.unitId ? [selection.unitId] : []
  const targets = hit.unitId ? hit.ownIds.filter((id) => id === hit.unitId) : hit.ownIds
  // Right-clicking the airfield itself (or the own air box) offers the batch draft before any
  // aircraft has been picked, so the player can start from the base as the spec describes.
  let draftOffered = false
  if (state.cursor?.phase === 'aircraft-refit' && !hit.unitId) {
    const base = refitBaseAt(state, side, hit)
    const draft = refitDraft(state, side, base, selection.unitIds ?? [], data)
    for (const option of refitChoiceLabels(draft)) {
      draftOffered = true
      add(option.label, 'refit-aircraft', { base: option.base, unitIds: option.unitIds })
    }
  }
  for (const id of targets) {
    const unit = state.units?.[id]
    const label = targets.length > 1 ? hit.labels[id] : ''
    for (const choice of choicesAt({ unitId: id, hex: hit.hex })) {
      const action = choice.actions[0]
      // The batch draft already covers every plane of this base, so the per-aircraft fallback would
      // only repeat the same charge under a second name.
      if (draftOffered && action.type === 'refit-aircraft') continue
      if (keepSelection.has(menuGroup(action))) append(choice, label)
    }
    if (unit && (movingWindow(state) || state.supply)) {
      counterCapabilities(state, side, id, hit.hex, data, (name, type, fields) => add(label ? `${label} · ${name}` : name, type, fields))
    }
  }
  if (movingWindow(state) && !hit.unitId && hit.hex && selected.length > 1 &&
      selected.every((id) => state.units[id]?.hex === hit.hex)) {
    add('将选中的运输点组成延补队', 'form-extender', { unitIds: selected })
  }
  const subject = selection.unitId
  if (!subject || !(hit.hex || hit.box)) return rows
  const unit = state.units?.[subject]
  const onSubject = hit.unitId === subject || unit?.hex === hit.hex && !hit.box
  if (!onSubject) {
    const route = hit.hex === selection.hex ? selection.route : undefined
    for (const choice of choicesAt({ unitId: subject, hex: hit.hex, route })) {
      const action = choice.actions[0]
      if (action.type === 'launch-air-mission') {
        if (actionTarget(action, hit)) append(choice)
      } else if (action.type === 'declare-artillery-barrage' || action.type === 'ground-move' && selected.length === 1) append(choice)
    }
    if (state.kind === 'playing' && !state.combat && !state.reroll && hit.hex) {
      airTargetChoices(state, side, subject, hit.hex, data, add)
      attackChoices(state, side, selected, hit.hex, selection.route ?? [], data, add)
    }
  }
  return rows
}

function movingWindow(state) {
  return state.kind === 'playing' && movementPhases.includes(state.cursor.phase) && state.turn.weather.ground === 'freeze' &&
    !state.reroll && !state.combat && !state.capture && !state.barrage && !state.airMission
}

function counterCapabilities(state, side, unitId, hex, data, add) {
  const unit = state.units[unitId]
  const { map, catalog } = data.assets
  if (!movingWindow(state)) {
    if (!state.supply || !unit.internalStocks || state.supply.fed.length || state.supply.attrition) return
    const ledger = scorpionSpPayment(state, side, map, data.board.supplyRail)
    const sources = ledger.available([unit])
    const cost = internalRecoveryPerLevel(unit.printedRe - unit.stepsLost)
    for (const steps of unit.internalStocks === 'exhausted' ? [1, 2] : [1]) {
      for (const preferred of sources) {
        let left = cost * steps
        const payments = [preferred, ...sources.filter((entry) => entry !== preferred)].flatMap(({ dumpId, tokens }) => {
          const spend = Math.min(left, tokens)
          left -= spend
          return spend ? [{ dumpId, tokens: spend }] : []
        })
        if (!left) add(`恢复部队储备 ${steps} 级 · ${payments.map(({ dumpId, tokens }) => `${ledger.source(dumpId).hex} ${tokens}T`).join('、')}`,
          'recover-internal-stocks', { unitId, payments })
      }
    }
    return
  }
  if (!unit.combat && !unit.extender) {
    const carried = carriedScorpionTokens(unit)
    const points = transportPoints(catalog.definitions.get(unit.definition))
    const onMap = state.dumps[`${side}:hex:${unit.hex}`]?.tokens ?? 0
    if (points) {
      for (let tokens = 2; tokens <= Math.min(points * 4 - carried, onMap); tokens++) add(`装载 ${tokens}T`, 'load-transport', { unitId, tokens })
      if (!unit.organicTruck) for (let tokens = 2; tokens <= carried; tokens++) add(`卸载 ${tokens}T`, 'unload-transport', { unitId, tokens })
      if (points === 5 && !carried) add('组成延补队', 'form-extender', { unitIds: [unitId] })
    }
    return
  }
  if (unit.extender) {
    add('将延补队转回运输点', 'dismantle-extender', { unitId })
    return
  }
  const ledger = scorpionSpPayment(state, side, map, data.board.supplyRail)
  const { transport } = state.groundActivity ?? {}
  if (transport && unit.mobility !== 'leg' && !unit.fueled && !hasScorpionBulkFuel(state, unitId)) {
    add('从停驻运输点加油 · 1T', 'fuel-from-paused-transport', { unitId, transportId: transport.unitId })
  }
  for (const { dumpId, tokens } of ledger.available([unit])) {
    const source = ledger.source(dumpId).hex
    const payment = (tokens) => [{ dumpId, tokens }]
    if (tokens >= 4) {
      if (unit.headquarters) add(`司令部加油 · ${source} 支付 1 SP`, 'fuel-headquarters', { headquartersId: unitId, payments: payment(4) })
      if (unit.formation && !hasScorpionBulkFuel(state, unitId)) {
        add(`编队加油 · ${source} 支付 1 SP`, 'fuel-formation', { formation: unit.formation, payments: payment(4) })
      }
    }
    if (hex && tokens >= 8 && state.cursor.phase === 'movement') {
      add(`修筑工事 · ${source} 支付 2 SP`, 'work-hedgehog', { operation: 'build', hex, unitIds: [unitId], payments: payment(8) })
    }
  }
  if (hex && state.hedgehogs?.[hex]) add('降低工事一级', 'work-hedgehog', { operation: 'reduce', hex, unitIds: [unitId] })
}

function airTargetChoices(state, side, id, hex, data, add) {
  if (!movingWindow(state)) return
  const plane = state.pieces.find((piece) => piece.id === id && piece.side === side && piece.kind === 'aircraft' && piece.active)
  if (!plane) return
  const target = { kind: 'hex', hex }
  if (Object.values(state.units).some((unit) => unit.side === opponent(side) && unit.hex === hex && unit.combat)) {
    add(`低空扫射 ${hex}`, 'launch-air-mission', { mission: 'hip-shoot', target, unitIds: [id] })
  }
  add(`运输破坏 ${hex}`, 'launch-air-mission', { mission: 'trainbusting', target, unitIds: [id] })
  const supplySource = plane.location
  if (supplySource.kind !== 'hex' && supplySource.kind !== 'off-map-air') return
  const source = supplySource.kind === 'hex' ? `${side}:hex:${supplySource.hex}` : `${side}:air-box`
  const supply = state.dumps[source]?.tokens ?? 0
  if (!supply) return
  const { transport } = aircraftProfile(plane, data.assets)
  const friendlyBase = state.airBases.some((base) => base.side === side && base.hex === hex)
  const modes = supplySource.kind === 'off-map-air' ? ['double-capacity'] : ['normal', 'double-capacity', 'extended']
  const labels = { normal: '普通航程', 'double-capacity': '双倍运力', extended: '加倍航程留场' }
  for (const mode of modes) {
    const cap = Math.min(supply, transport * airTransportModes[mode].capacity)
    for (let supplyTokens = 1; supplyTokens <= cap; supplyTokens++) {
      const order = { target, unitIds: [id], supplyTokens, supplySource, flightModes: [{ id, mode }] }
      if (friendlyBase) add(`空运 ${supplyTokens}T 到 ${hex} · ${labels[mode]}`, 'launch-air-mission', { ...order, mission: 'transport' })
      if (mode !== 'extended') add(`空投 ${supplyTokens}T 到 ${hex} · ${labels[mode]}`, 'launch-air-mission', { ...order, mission: 'air-drop' })
    }
  }
}

function attackChoices(state, side, ids, target, route, data, add) {
  const { map } = data.assets
  const units = ids.map((id) => state.units[id])
  if (!units.length || units.some((unit) => !unit?.attackCapable || unit.side !== side) ||
      !Object.values(state.units).some((unit) => unit.side === opponent(side) && unit.combat && unit.hex === target)) return
  const { phase } = state.cursor
  const base = units[0].hex
  const regular = ['combat', 'exploitation'].includes(phase) && units.every((unit) => map.neighbors(unit.hex).includes(target))
  const overrun = movingWindow(state) && units.every((unit) => unit.hex === base) &&
    units.every((unit) => canMoveInPhase(unit, phase))
  const approach = route.at(-1) === target ? route.slice(0, -1) : route
  const path = approach.length && map.neighbors(approach.at(-1)).includes(target) ? approach : []
  if (!regular && !(overrun && map.neighbors(path.at(-1) ?? base).includes(target))) return
  const ledger = scorpionSpPayment(state, side, map, data.board.supplyRail)
  const sources = units.map((unit) => ledger.available([unit]))
  const options = [...new Set(sources.flatMap((entries) => entries.map(({ dumpId }) => dumpId)))]
  for (const type of [...(regular ? ['declare-combat'] : []), ...(overrun ? ['declare-overrun'] : [])]) {
    if (type === 'declare-overrun' && !map.neighbors(path.at(-1) ?? base).includes(target)) continue
    for (const preferred of options.length ? options : [undefined]) {
      const plan = attackPayment(state, ids, units, sources, preferred, type === 'declare-overrun')
      if (!plan) continue
      const { fuel, payments, internalUnitIds } = plan
      const costs = [...payments, ...fuel.map(({ dumpId }) => ({ dumpId, tokens: 1 }))].reduce((totals, { dumpId, tokens }) =>
        totals.set(dumpId, (totals.get(dumpId) ?? 0) + tokens), new Map())
      const spending = [...costs].map(([id, count]) => `${state.units[id]?.hex ?? id.split(':').at(-1)} ${count}T`)
      if (internalUnitIds.length) spending.push(`${internalUnitIds.length} 枚动用部队储备`)
      const label = `${type === 'declare-overrun' ? '突袭' : '攻击'} ${target} · ${ids.length} 枚 · ${spending.join('、')}`
      add(label, type, { target, attackers: ids, payments, internalUnitIds, ...(type === 'declare-overrun' ? { fuel, path } : {}) })
    }
  }
}

function attackPayment(state, ids, units, sources, preferred, overrun) {
  const balances = new Map(sources.flat().map(({ dumpId, tokens }) => [dumpId, tokens]))
  const options = sources.map((entries) => entries.map(({ dumpId }) => dumpId).sort((a, b) => Number(b === preferred) - Number(a === preferred)))
  const fuel = []
  for (const [index, unit] of units.entries()) {
    const unitId = ids[index]
    if (!overrun || unit.mobility === 'leg' || unit.fueled || hasScorpionBulkFuel(state, unitId)) continue
    const dumpId = options[index].find((id) => balances.get(id) > 0)
    if (!dumpId) return
    fuel.push({ unitId, dumpId })
    balances.set(dumpId, balances.get(dumpId) - 1)
  }
  const payments = []
  const internalUnitIds = []
  // Pay counters with the fewest sources first, keeping the full stack's shared balance.
  const indexes = units.map((_, i) => i).sort((a, b) => options[a].length - options[b].length)
  for (const index of indexes) {
    const unit = units[index]
    const unitId = ids[index]
    const rows = options[index]
    let left = remainingSteps(unit)
    if (rows.reduce((total, id) => total + balances.get(id), 0) < left) {
      if (unit.internalStocks === 'exhausted') return
      internalUnitIds.push(unitId)
      continue
    }
    for (const dumpId of rows) {
      const tokens = Math.min(left, balances.get(dumpId))
      if (!tokens) continue
      payments.push({ unitId, dumpId, tokens })
      balances.set(dumpId, balances.get(dumpId) - tokens)
      left -= tokens
      if (!left) break
    }
  }
  return { payments, internalUnitIds, fuel }
}
