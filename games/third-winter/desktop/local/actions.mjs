import { actingSide } from '@ocs-eastern/series/turn'
import { airbaseActiveCapacity } from '@ocs-eastern/series/airbase'
import { barrageColumn } from '@ocs-eastern/series/tables/barrage'
import { scorpionGroundMpAvailable, canMoveInPhase, walkScorpionGroundRoute } from '../../src/match/scorpion-movement.ts'
import { scorpionScheduledArrivals } from '../../src/match/scorpion-reinforcement.ts'
import { scorpionMovementRules } from '../../src/match/scorpion-ground-actions.ts'
import { hasScorpionBulkFuel } from '../../src/match/scorpion-fuel.ts'
import { scorpionSpPayment, carriedScorpionTokens } from '../../src/match/scorpion-sp-payment.ts'
import { remainingSteps } from '../../src/match/scorpion-losses.ts'
import { scorpionOpeningAirBases } from '../../src/ttw/scorpion/setup-stores.ts'
import { scorpionBarrageFrontAt } from '../../src/ttw/scorpion/barrage-markers.ts'
import { artilleryChoices, artilleryDraft, frontBarrageDraft, frontChoices } from './barrage-draft.mjs'
import { refitBaseOf, refitChoiceLabels, refitDraft, sameBase } from './refit.mjs'
import { repliesFor } from './replies.mjs'
import { supplyDraft } from './supply-draft.mjs'

export const opponent = (side) => side === 'axis' ? 'soviet' : 'axis'
export const sideName = (side) => side === 'axis' ? '轴心' : '苏军'
export const phaseNames = { 'aircraft-refit': '飞机整备', reinforcement: '增援', movement: '移动', supply: '补给',
  reaction: '反应', combat: '战斗', exploitation: '扩张', cleanup: '整理' }

export function localDecisionSide(state) {
  if (state.kind === 'setup') return state.opening.seat
  if (state.reroll) return state.rerollHolder
  if (state.capture) return state.capture.owner
  if (state.combat?.retreat) return state.combat.retreat.side
  if (state.airfieldCapacityChoice) return state.airfieldCapacityChoice.side
  if (state.barrage) return state.barrage.defender
  if (state.airMission) {
    const step = state.airMission.step
    return step.kind === 'return' ? state.pieces.find(({ id }) => state.airMission.returning.includes(id))?.side ?? state.airMission.side : step.actor
  }
  if (state.combat) {
    const { attacker, step } = state.combat
    return ['attacker-rating', 'attacker-result', 'advance'].includes(step) ? attacker : opponent(attacker)
  }
  if (['retention', 'choose-order'].includes(state.turn.step.kind)) return state.turn.step.responder
  return actingSide(state.cursor.phasing, state.cursor.phase)
}

export function localRoster(state, side, data, base) {
  const { catalog } = data.assets
  const pick = (id, definition, hex, detail) => ({ id, hex, label: [catalog.definitions.get(definition)?.source.name ?? id, detail ?? hex].filter(Boolean).join(' · ') })
  if (state.kind === 'setup') {
    const { pieces, drawnAlerts, lossChoices, units } = state.opening
    const air = pieces.filter((piece) => piece.side === side && piece.kind === 'aircraft' && piece.location.kind !== 'dead-pile')
    const queued = (piece) => Number(piece.location.kind !== 'air-setup')
    const counters = side === 'axis' ? [...drawnAlerts].sort((a, b) => Number(!!units[a.id]) - Number(!!units[b.id])).map((counter) =>
      pick(counter.id, counter.definition, units[counter.id]?.hex, '警戒营')) : lossChoices.flatMap(({ candidates, selected }) =>
      candidates.map((id) => pick(id, units[id].definition, units[id].hex, selected === id ? '已选步损' : '二选一步损')))
    return [...counters.filter(({ id }) => side === 'axis' && !units[id]), ...air.sort((a, b) => queued(a) - queued(b)).map((piece) =>
      pick(piece.id, piece.definition, piece.location.hex, piece.location.kind === 'air-setup' ? '待部署' : piece.location.hex ?? '地图外空军盒')),
    ...counters.filter(({ id }) => side !== 'axis' || units[id])]
  }
  const { units, pieces, cursor, window } = state
  if (cursor.phase === 'reinforcement' && window?.stage === 'scheduled') {
    return localArrivals(state, side, data).map((entry) => pick(entry.id, entry.definition, undefined,
      entry.optionalForce ? '可选增援' : '定期增援'))
  }
  const aircraft = pieces.filter((piece) => piece.side === side && piece.kind === 'aircraft' && piece.location.kind !== 'dead-pile')
  if (cursor.phase === 'aircraft-refit') {
    // The panel lists aircraft only, and once a base is open it lists that base alone, so the
    // player cannot tick a plane the rule layer would reject for this airfield or air box.
    const listed = base ? aircraft.filter((piece) => sameBase(refitBaseOf(state, side, piece), base) && !piece.active) : aircraft
    return listed.map((piece) => pick(piece.id, piece.definition, piece.location.hex,
      [`${piece.active ? '已激活' : '非激活'} · ${piece.location.hex ?? '地图外空军盒'}`,
        ...(base ? [] : [refitBaseOf(state, side, piece) ? '可整备' : '无机场'])].join(' · ')))
  }
  return [...Object.entries(units).filter(([, unit]) => unit.side === side).map(([id, unit]) => pick(id, unit.definition, unit.hex)),
    ...aircraft.map((piece) => pick(piece.id, piece.definition, piece.location.hex, piece.location.hex ?? '地图外空军盒'))]
}

function localArrivals(state, side, data) {
  return data.board.reinforcements(state).catalog.filter(({ id, side: owner, turn, optionalForce }) =>
    side === owner && !state.arrival.placed.includes(id) && (optionalForce ? turn <= state.cursor.turn : turn === state.cursor.turn))
}

export function localChoices(state, side, selection, data) {
  const choices = []
  const add = (label, type, fields = {}) => choices.push({ label, actions: [{ type, ...fields }] })
  const batch = (label, actions) => choices.push({ label, actions })
  const { unitId, hex, route = [] } = selection
  const { map, catalog } = data.assets
  if (state.kind === 'setup') {
    const setup = state.opening
    const waiting = setup.pieces.filter((piece) => piece.side === side && piece.location.kind === 'air-setup')
    const aircraft = setup.pieces.find((piece) => piece.id === unitId && piece.side === side && piece.kind === 'aircraft' && piece.location.kind !== 'dead-pile')
    const base = scorpionOpeningAirBases.find((item) => item.side === side)
    if (aircraft) {
      const parked = setup.pieces.filter((piece) => piece.id !== unitId && piece.location.kind === 'hex' && piece.location.hex === base.hex)
      if (aircraft.location.hex !== base.hex && parked.length < airbaseActiveCapacity(base.level)) {
        add(`部署到机场 ${base.hex}`, 'base-aircraft', { id: unitId, base: { kind: 'hex', hex: base.hex } })
      }
      if (aircraft.location.kind !== 'off-map-air') add('部署到地图外空军盒', 'base-aircraft', { id: unitId, base: { kind: 'off-map-air' } })
    }
    if (waiting.length > 1) batch(`将剩余 ${waiting.length} 架飞机部署到空军盒`, waiting.map(({ id }) =>
      ({ type: 'base-aircraft', id, base: { kind: 'off-map-air' } })))
    const alerts = side === 'axis' ? setup.drawnAlerts.filter(({ id }) => !setup.units[id]) : []
    const losses = side === 'soviet' ? setup.lossChoices.filter((entry) => !entry.selected) : []
    const alert = setup.drawnAlerts.find(({ id }) => id === unitId)
    if (side === 'axis' && alert) {
      const units = Object.entries(setup.units)
      const re = catalog.definitions.get(alert.definition).source.re
      const destinations = [...new Set(units.filter(([id, unit]) => id.startsWith('setup:') && unit.side === side).map(([, unit]) => unit.hex))]
        .filter((at) => units.reduce((total, [id, unit]) => total + (id !== unitId && unit.hex === at ? unit.printedRe - unit.stepsLost : 0), re) <= 10)
      for (const at of destinations.includes(hex) ? [hex] : destinations.slice(0, 4)) add(`警戒营部署到 ${at}`, 'place-setup-alert', { id: unitId, hex: at })
    }
    for (const { candidates, stepsLost } of unitId && losses.some((item) => item.candidates.includes(unitId))
      ? losses.filter((item) => item.candidates.includes(unitId)) : losses.slice(0, 1)) {
      for (const id of candidates) add(`${catalog.definitions.get(setup.units[id].definition).source.name} 损失 ${stepsLost} 步`, 'choose-setup-loss', { id })
    }
    if (!waiting.length && !alerts.length && !losses.length) add('确认本方部署', 'confirm-setup')
    return choices
  }
  if (state.victory || state.turn.step.kind === 'ended') return choices
  if (repliesFor(state, side, selection, data, add)) return choices
  const { phase } = state.cursor
  const unit = state.units[unitId]
  if (phase === 'aircraft-refit') {
    // One draft per base: the player opens an airfield hex (or the off-map air box), ticks the
    // inactive aircraft of that base, picks a payable dump, and submits the whole batch once.
    const draft = refitDraft(state, side, selection.refitBase, selection.unitIds ?? [], data)
    if (draft) for (const option of refitChoiceLabels(draft)) {
      add(option.label, 'refit-aircraft', { base: option.base, unitIds: option.unitIds })
    }
    else if (unitId) {
      // Without an opened base the roster click still refits one aircraft, as it always could.
      const aircraft = state.pieces.find((piece) => piece.id === unitId && piece.side === side && !piece.active && piece.location.kind !== 'dead-pile')
      if (aircraft?.location.kind === 'off-map-air') add('免费整备选中飞机', 'refit-aircraft', { base: { kind: 'off-map-air' }, unitIds: [unitId] })
      if (aircraft?.location.kind === 'hex') {
        const hex = aircraft.location.hex
        const ledger = scorpionSpPayment(state, side, map, data.board?.supplyRail)
        for (const [dumpId, dump] of Object.entries(state.dumps)) if (dump.side === side && dump.location === 'on-map' && dump.tokens &&
          ledger.network.canUseDump(hex, dumpId.split(':').at(-1))) {
          add(`整备选中飞机 · ${dumpId.split(':').at(-1)} 支付 1T`, 'refit-aircraft', { base: { kind: 'hex', hex, dumpId }, unitIds: [unitId] })
        }
      }
    }
    add('结束飞机整备', 'complete-refit')
  } else if (phase === 'reinforcement') {
    reinforcementChoices(state, side, selection, data, add, batch)
  } else if (phase === 'supply') {
    supplyChoices(state, side, selection, data, add)
  } else {
    if (['movement', 'reaction', 'exploitation'].includes(phase)) {
      const ids = selection.unitIds ?? []
      if (ids.length > 1 && phase === 'movement' && route.length && ids.every((id) => state.units[id]?.reserve && state.units[id].hex === unit?.hex)) {
        add(`预备堆叠沿途 ${route.join(' → ')} 移动`, 'reserve-stack-move', { path: route, counters: ids.map((unitId) => ({ unitId })) })
      }
      moveChoices(state, side, unitId, hex, route, data, add)
    }
    if (['reaction', 'combat', 'exploitation'].includes(phase) && state.turn.weather.ground !== 'thaw') {
      engagementChoices(state, side, unitId, hex, data, add)
    }
    // TTW 3.4a: the front marker is spent in Soviet turn-one Movement. The marker itself, its centre
    // and its targets are collected here; scorpion-barrage.ts still decides whether it may fire.
    if (phase === 'movement' && side === 'soviet' && state.cursor.turn === 1) {
      frontBarrageChoices(state, side, hex, data, add)
    }
    add(`结束${phaseNames[phase]}`, `complete-${phase}`)
  }
  return choices
}

function reinforcementChoices(state, side, { unitId, hex }, data, add, batch) {
  const window = state.window
  const rules = data.board.reinforcements(state)
  if (window.stage === 'scheduled') {
    const candidates = localArrivals(state, side, data)
    // Entry-hex availability decides what can be placed now, never whether an obligation exists.
    const { placeable: outstanding, blocked } = scorpionScheduledArrivals(state, side, rules)
    const picked = candidates.find(({ id }) => id === unitId) ?? outstanding[0]
    if (picked) for (const at of rules.arrivalDestinations(picked)) {
      add(`入场到 ${at}${picked.optionalForce && !state.arrival.mobilized.includes(picked.optionalForce) ? ' · 首次调入扣 5 VP' : ''}`,
        'place-arrival', { arrivalId: picked.id, hex: at })
    }
    const fixedEntries = outstanding.flatMap((entry) => {
      const at = rules.arrivalDestinations(entry)
      return at.length === 1 ? [{ type: 'place-arrival', arrivalId: entry.id, hex: at[0] }] : []
    })
    if (fixedEntries.length > 1) batch(`放置 ${fixedEntries.length} 枚只有一个入场格的定期增援`, fixedEntries)
    if (window.fixedTokens) for (const id of window.fixedDestinations) add(`放置固定补给 ${window.fixedTokens}T · ${id}`,
      'place-supply', { target: { kind: 'hex', id }, tokens: window.fixedTokens })
    if (!outstanding.length && !window.fixedTokens) {
      // OCS 13.6 keeps a blocked arrival an obligation; the player must see where it goes, so the
      // forfeiture is named on the choice that records it instead of disappearing.
      for (const entry of blocked) add(`无法入场：${entry.id} 印刷入场格全部被敌方占据，按 OCS 13.6 记录为未到场`,
        'finish-scheduled-arrivals')
      add('完成定期增援并处理可变补给', 'finish-scheduled-arrivals')
    }
    return
  }
  if (window.variableTokens) {
    const sources = [...rules.supplySources[side]].filter((id) => rules.controlOf(id) !== opponent(side))
    for (const id of sources.includes(hex) ? [hex] : sources) add(`放置 ${window.variableTokens}T · ${id}`, 'place-supply',
      { target: { kind: 'hex', id }, tokens: window.variableTokens })
    add(`放置 ${window.variableTokens}T · 地图外空军盒`, 'place-supply', { target: { kind: 'air-box' }, tokens: window.variableTokens })
  }
  if (window.pendingAlert) {
    for (const hex of rules.alertDestinations(window.pendingAlert)) add(`警戒营入场 · ${hex}`, 'place-alert', { hex })
    add('放弃本次警戒营', 'pass-alert')
  }
  if (!window.variableTokens && !window.pendingAlert) add('结束增援', 'complete-reinforcement')
}

function supplyChoices(state, side, selection, data, add) {
  const { splits, attrition } = state.supply
  const pending = splits.find((split) => !split.selected)
  if (pending) {
    for (const anchor of pending.anchors) {
      const id = anchor.slice(anchor.indexOf(':') + 1)
      const display = state.units[id] ? `${state.units[id].hex} ${data.assets.catalog.definitions.get(state.units[id].definition)?.source.name ?? 'HQ'}` : id
      add(`${pending.formation} 追溯 · ${display}`, 'choose-formation-trace', { formation: pending.formation, anchor })
    }
  } else if (!attrition) {
    const ids = selection.unitIds ?? (selection.unitId ? [selection.unitId] : [])
    for (const { label, action } of supplyDraft(state, side, ids, data)?.choices ?? []) {
      add(label, action.type, { payments: action.payments })
    }
    add('确认追溯补给并检查断补损耗', 'check-attrition')
  } else {
    const stack = attrition.find((entry) => !entry.assigned)
    if (!stack) add('结束补给', 'complete-supply')
    else {
      for (const id of stack.units) {
        const order = [id, ...stack.units.filter((other) => other !== id)]
        let left = stack.losses
        const allocation = []
        for (const unitId of order) {
          const steps = Math.min(left, remainingSteps(state.units[unitId]))
          if (!steps) break
          allocation.push({ unitId, steps })
          left -= steps
        }
        add(`${stack.hex} 分配 ${stack.losses} 步损失 · 优先 ${data.assets.catalog.definitions.get(state.units[id].definition).source.name}`,
          'assign-attrition', { hex: stack.hex, allocation })
      }
    }
  }
}

function moveChoices(state, side, unitId, hex, route, data, add) {
  const { map } = data.assets
  const unit = state.units[unitId]
  const { phase } = state.cursor
  if (unit?.side === side) {
    if (state.overrunMarch?.remaining[unitId] !== undefined && route.length) {
      add(`突袭后沿途 ${route.join(' → ')} 移动`, 'continue-overrun-move', { path: route })
      return
    }
    if (phase === 'movement' && !state.moved.includes(unitId)) {
      if (unit.combat && !unit.reserve) {
        add('切换到' + (unit.moveMode ? '战斗面' : '移动面'), 'set-ground-mode', { unitId, face: unit.moveMode ? 'combat' : 'move' })
        if (!unit.disorganized && !unit.exploit) add('进入预备队', 'mark-reserve', { unitId })
      } else if (unit.reserve) add('取消预备队状态', 'leave-reserve', { unitId })
    }
    if (unit.reserve && phase !== 'movement') add('释放预备队', 'release-reserve', { unitId })
    if (unit.combat === false && !unit.extender && state.turn.weather.ground === 'freeze') {
      if (carriedScorpionTokens(unit) && !unit.organicTruck) add('卸载 1T', 'unload-transport', { unitId, tokens: 1 })
      if (state.dumps[`${side}:hex:${unit.hex}`]?.tokens) add('装载 1T', 'load-transport', { unitId, tokens: 1 })
    }
    const path = route.length ? route : hex && map.neighbors(unit.hex).includes(hex) ? [hex] : []
    const continuation = state.groundCaptureMove?.[unitId]
    if (path.length && canMoveInPhase(unit, phase) && unit.allowance > 0 && state.turn.weather.ground === 'freeze' &&
      (!state.moved.includes(unitId) || continuation !== undefined || state.groundActivity?.transport?.unitId === unitId)) {
      const { rules } = scorpionMovementRules(state, side, map, data.board)
      try {
        walkScorpionGroundRoute(unit, path, rules, scorpionGroundMpAvailable(state, unitId, continuation), continuation === undefined)
      } catch { return }
      const needsFuel = unit.combat && unit.mobility !== 'leg' && !unit.fueled && !hasScorpionBulkFuel(state, unitId)
      if (needsFuel) for (const { dumpId } of scorpionSpPayment(state, side, map).available([unit])) {
        add(`移动到 ${path.at(-1)} · ${dumpId.split(':').at(-1)} 支付 1T`, 'ground-move', { unitId, path, fuelDumpId: dumpId })
      }
      else add(`沿途 ${path.join(' → ')} 移动`, 'ground-move', { unitId, path })
      if (needsFuel) for (const { id } of state.headquartersFuel ?? []) {
        const source = state.units[id]
        if (source?.side === side) add(`移动到 ${path.at(-1)} · 由 ${source.hex} 已加油司令部投送`,
          'ground-move', { unitId, path, fuelHeadquartersId: id })
      }
    }
    return
  }
  const aircraft = state.pieces.find((piece) => piece.id === unitId && piece.side === side && piece.active && piece.location.kind !== 'dead-pile')
  if (!aircraft || state.turn.weather.flight === 'none' || state.turn.weather.flight === 'limited' && phase !== 'movement') return
  const mission = (label, mission, target, fields = {}) => add(label, 'launch-air-mission', { mission, target, unitIds: [unitId], ...fields })
  if (aircraft.location.kind !== 'off-map-air') mission('转场到地图外空军盒', 'base-transfer', { kind: 'off-map-air' })
  if (!hex || hex === aircraft.location.hex) return
  const base = state.airBases.find((base) => base.hex === hex)
  const target = { kind: 'hex', hex }
  if (base?.side === side) mission(`转场到 ${hex}`, 'base-transfer', target)
  if (base?.side === opponent(side)) {
    mission(`战斗机扫荡 ${hex}`, 'fighter-sweep', target)
    mission(`轰炸机场 ${hex}`, 'barrage', target, { targetKind: 'air-base' })
  }
  if (Object.values(state.units).some((unit) => unit.side !== side && unit.combat && unit.hex === hex)) {
    mission(`对地轰炸 ${hex}`, 'barrage', target)
  }
}

function engagementChoices(state, side, unitId, hex, data, add) {
  const unit = state.units[unitId]
  if (!unit || unit.side !== side || !hex || unit.hex === hex) return
  const { map } = data.assets
  const enemy = opponent(side)
  const groundTarget = Object.values(state.units).some((item) => item.side === enemy && item.hex === hex && item.combat)
  if (state.cursor.phase !== 'reaction' && unit.attackCapable && groundTarget && map.neighbors(unit.hex).includes(hex) && !state.combatAttackers.includes(unitId)) {
    const tokens = remainingSteps(unit)
    const usable = scorpionSpPayment(state, side, map).available([unit])
    for (const { dumpId } of usable.filter((item) => item.tokens >= tokens)) add(`攻击 ${hex} · ${dumpId.split(':').at(-1)} 支付 ${tokens}T`,
      'declare-combat', { target: hex, attackers: [unitId], payments: [{ unitId, dumpId, tokens }] })
    if (unit.internalStocks !== 'exhausted' && usable.reduce((total, row) => total + row.tokens, 0) < tokens) {
      add(`攻击 ${hex} · 动用部队储备`, 'declare-combat', { target: hex, attackers: [unitId], payments: [], internalUnitIds: [unitId] })
    }
  }
  // Combined fire: the target hex itself lists every battery that can join, alone or together, with
  // the shared dump or common HQ that pays for the column.
  const artillery = artilleryDraft(state, side, hex, data, [unitId])
  for (const row of artilleryChoices(artillery)) add(row.label, row.type, { target: row.target, batteries: row.batteries, supply: row.supply })
  const base = state.airBases.some((item) => item.side === enemy && item.hex === hex)
  if (!unit.artillery || unit.reserve || !base) return
  const strength = unit.artillery.strength
  if (!strength) return
  const { cost } = barrageColumn(data.board.facilityBarrage, strength)
  const ledger = scorpionSpPayment(state, side, map)
  for (const { dumpId, tokens } of ledger.available([unit]).filter(({ dumpId }) => ledger.canUse(unit, dumpId, {}))) {
    if (tokens >= cost) add(`炮击机场 ${hex} · ${cost}T`, 'declare-artillery-barrage',
      { target: hex, targetKind: 'air-base', batteries: [{ unitId, ...(unit.artillery.independentRe ? { re: remainingSteps(unit) } : {}) }],
        supply: { kind: 'direct', payments: [{ dumpId, tokens: cost }] } })
  }
}

/**
 * Front barrage candidate layer: the marker click opens its sector, a centre-hex click lists the
 * Army HQ that can support it and the volleys it could fire. Only real commands are offered, so the
 * window never shows a row the session would reject; an unavailable marker is surfaced by the
 * controller from frontBarrageDraft's reason instead.
 */
function frontBarrageChoices(state, side, hex, data, add) {
  // state.frontBarrage only exists once the marker has been placed; before that the sector comes from
  // the centre hex the player clicked.
  const front = state.frontBarrage?.front ?? (hex ? frontAtOf(hex) : undefined)
  if (!front) return
  for (const choice of frontChoices(frontBarrageDraft(state, side, data, front, hex))) {
    add(choice.label, choice.type, { front: choice.front, center: choice.center, hqId: choice.hqId, volleys: choice.volleys })
  }
}

const frontAtOf = (hex) => {
  try { return scorpionBarrageFrontAt(hex) } catch { return undefined }
}
