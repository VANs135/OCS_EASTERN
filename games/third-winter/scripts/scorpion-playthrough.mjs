import assert from 'node:assert/strict'
import { verifyRngState } from '@ocs-eastern/series/rng'
import { scorpionOverstackedHexes, scorpionThawEntryHexes } from '../src/match/scorpion-stacking.ts'
import { currentScorpionTurn } from '../src/match/scorpion-round.ts'
import { scorpionReinforcementBoard } from '../src/match/scorpion-reinforcement-board.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { remainingSteps } from '../src/match/scorpion-losses.ts'
import { scorpionSpPayment } from '../src/match/scorpion-sp-payment.ts'
import { hasTrace } from '../src/match/scorpion-supply-phase.ts'
import { scorpionSupplySources } from '../src/ttw/scorpion/initial-map.ts'
import { scorpionStepCost } from '../src/ttw/scorpion/terrain-cost.ts'
import { scorpionSessionBoxFrame } from '../src/view/scorpion-boxes.ts'
import { scorpionBarrageMarkerFrame } from '../src/view/scorpion-barrage-markers.ts'
import { scorpionMapStacks } from '../src/view/scorpion-map-counters.ts'
import { submitScorpionDemo } from './scorpion-demo-commands.mjs'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'

const opponent = (side) => side === 'axis' ? 'soviet' : 'axis'

/** Play the printed schedule from deployment. The choices are deterministic, and the engine supplies all dice. */
export function playScorpionToEnd(setup, assets, arrivals, { seed, withdraw, sovietOptional = false, onComplete }) {
  const { map, catalog } = assets
  const board = { reinforcements: (state) => scorpionReinforcementBoard(state, assets, arrivals) }
  let record = sampleScorpionOpening(setup, assets, seed).started
  const current = () => record.state
  const turns = []
  let reloads = 0
  let blockedEntries = 0
  let relocations = 0
  const attrition = { axis: 0, soviet: 0 }
  const onDnepr = (hex) => hex === 's22.08' || map.neighbors(hex).some((near) => map.edge(hex, near)?.river === 'major')

  function displayed(state) {
    const barrage = scorpionBarrageMarkerFrame(state, catalog)
    return { boxes: scorpionSessionBoxFrame(state, catalog), aid: barrage.aidCounters,
      map: scorpionMapStacks(state, catalog, barrage.mapCounters) }
  }

  function submit(action, side = current().cursor.phasing) {
    const command = { id: `playthrough-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionDemo(record, side, command, assets, board).record
    if (current().cursor.phase === 'supply' && action.type === 'check-attrition' && current().turn.weather.ground === 'thaw') {
      assert.deepEqual(current().supply.attrition, [], 'Thaw must mark trace without rolling attrition')
    }
    if (action.type === 'complete-cleanup') {
      const saved = JSON.stringify(record)
      const original = displayed(current())
      record = JSON.parse(saved)
      assert.ok(verifyRngState(current().rng))
      assert.deepEqual(displayed(current()), original)
      assert.equal(submitScorpionSession(record, side, command, assets, board).duplicate, true)
      reloads++
    }
  }

  function reinforce(side, turn) {
    const rules = board.reinforcements(current())
    const scheduled = rules.catalog.filter((entry) => entry.side === side && !current().arrival.placed.includes(entry.id) &&
      (entry.optionalForce ? turn >= entry.turn && (side === 'axis' ? withdraw : sovietOptional) : entry.turn === turn))
    for (const entry of scheduled) {
      const legal = board.reinforcements(current()).arrivalDestinations(entry)
      if (!legal.length) { blockedEntries++; continue }
      const [hex] = [...legal].sort((a, b) => stack(a) - stack(b))
      submit({ type: 'place-arrival', arrivalId: entry.id, hex })
      if (current().victory) return
    }
    const { fixedTokens, fixedDestinations } = current().window
    if (fixedTokens) submit({ type: 'place-supply', target: { kind: 'hex', id: fixedDestinations[0] }, tokens: fixedTokens })
    submit({ type: 'finish-scheduled-arrivals' })
    const { variableTokens, pendingAlert } = current().window
    if (variableTokens) {
      const id = [...rules.supplySources[side]][0]
      submit({ type: 'place-supply', target: { kind: 'hex', id }, tokens: variableTokens })
    }
    if (pendingAlert) {
      const [hex] = [...board.reinforcements(current()).alertDestinations(pendingAlert)].sort((a, b) => stack(a) - stack(b))
      submit(hex ? { type: 'place-alert', hex } : { type: 'pass-alert' })
    }
    submit({ type: 'complete-reinforcement' })
  }

  const stack = (hex) => Object.values(current().units).filter((unit) => unit.combat && unit.hex === hex)
    .reduce((total, unit) => total + remainingSteps(unit), 0)

  function moveToRoom(side, unitId, unit, leaveRiver) {
    const enemy = opponent(side)
    const blocked = new Set([...scorpionSupplySources[enemy],
      ...Object.values(current().units).filter((item) => item.side === enemy).map(({ hex }) => hex)])
    const ledger = unit.mobility === 'leg' ? null : scorpionSpPayment(current(), side, map, board.supplyRail)
    const fuel = ledger?.available([unit]).find(({ tokens }) => tokens > 0)
    if (ledger && !fuel) return false
    const destination = map.neighbors(unit.hex).find((hex) => !blocked.has(hex) && (!leaveRiver || !onDnepr(hex)) &&
      stack(hex) + remainingSteps(unit) <= 10 && scorpionStepCost(map, unit.hex, hex, unit.mobility, 'freeze') !== null)
    if (!destination) return false
    submit({ type: 'ground-move', unitId, path: [destination], ...(fuel ? { fuelDumpId: fuel.dumpId } : {}) })
    assert.ok(!current().capture, 'The scripted logistical moves should avoid capture windows')
    relocations++
    return true
  }

  function movement(side) {
    const own = Object.entries(current().units).filter(([, unit]) => unit.side === side && unit.combat)
    if (current().turn.weather.ground === 'freeze') {
      for (const [unitId, unit] of own.filter(([, unit]) => unit.allowance > 0)) {
        const river = withdraw && side === 'axis' && onDnepr(unit.hex)
        if (river || stack(unit.hex) > 10) moveToRoom(side, unitId, unit, river)
      }
    }
    if (settleStacking(side)) submit({ type: 'complete-movement' })
  }

  function settleStacking(side) {
    const exempt = scorpionThawEntryHexes(current(), board.reinforcements(current()))
    for (const { hex, re, limit, candidates } of scorpionOverstackedHexes(current(), side, exempt)) {
      let left = re
      const unitIds = []
      for (const candidate of [...candidates].sort((a, b) => a.re - b.re)) {
        unitIds.push(candidate.unitId)
        left -= candidate.re
        if (left <= limit) break
      }
      submit({ type: 'settle-stacking', hex, unitIds }, side)
      if (current().victory) return false
    }
    return true
  }

  function supply(side) {
    for (const { formation, anchors, members } of current().supply.splits) {
      const count = (anchor) => members.filter((id) => hasTrace({ ...current().supply,
        splits: [{ members, selected: anchor }] }, id)).length
      const [anchor] = [...anchors].sort((a, b) => count(b) - count(a))
      submit({ type: 'choose-formation-trace', formation, anchor })
    }
    if (withdraw && side === 'axis' && current().turn.weather.ground === 'freeze') {
      for (const [unitId, unit] of Object.entries(current().units)) {
        if (unit.side !== side || !unit.combat || hasTrace(current().supply, unitId)) continue
        const re = remainingSteps(unit)
        const available = scorpionSpPayment(current(), side, map, board.supplyRail).available([unit])
        const dump = available.find(({ tokens }) => tokens >= Math.ceil(re / 2))
        if (dump) submit({ type: 'feed-units', payments: [{ dumpId: dump.dumpId, portions: [{ unitId, re }] }] })
      }
    }
    const before = current().rng.drawCount
    submit({ type: 'check-attrition' })
    if (current().turn.weather.ground === 'thaw') assert.equal(current().rng.drawCount, before)
    for (const { hex, units, losses } of current().supply.attrition) {
      if (!losses) continue
      let left = losses
      const allocation = []
      for (const unitId of units) {
        const steps = Math.min(left, remainingSteps(current().units[unitId]))
        if (!steps) break
        allocation.push({ unitId, steps })
        left -= steps
      }
      assert.equal(left, 0)
      submit({ type: 'assign-attrition', hex, allocation })
      attrition[side] += losses
      if (current().victory) return
    }
    submit({ type: 'complete-supply' })
  }

  for (let commands = 0; commands < 200 && !current().victory && current().turn.step.kind !== 'ended'; commands++) {
    const { cursor, turn } = current()
    if (turn.step.kind === 'retention' && turn.number === 2 && turn.step.responder === 'soviet') {
      submit({ type: 'retain-initiative', dumpId: 'soviet:hex:s1.14' }, 'soviet')
    } else if (turn.step.kind === 'retention' || turn.step.kind === 'roll') {
      submit({ type: 'roll-initiative' }, turn.step.kind === 'retention' ? turn.step.responder : cursor.phasing)
    } else if (turn.step.kind === 'choose-order') {
      submit({ type: 'choose-first', first: turn.number % 2 ? 'soviet' : 'axis' }, turn.step.responder)
    } else if (turn.step.kind === 'player-turn') {
      if (turns.at(-1)?.turn !== turn.number) turns.push({ turn: turn.number, first: cursor.first,
        ground: turn.weather.ground, flight: turn.weather.flight, phases: [] })
      turns.at(-1).phases.push(`${cursor.phasing}:${cursor.phase}`)
      if (cursor.phase === 'aircraft-refit') {
        if (settleStacking(cursor.phasing)) submit({ type: 'complete-refit' })
      }
      else if (cursor.phase === 'reinforcement') reinforce(cursor.phasing, turn.number)
      else if (cursor.phase === 'movement') movement(cursor.phasing)
      else if (cursor.phase === 'supply') supply(cursor.phasing)
      else {
        const actor = cursor.phase === 'reaction' ? opponent(cursor.phasing) : cursor.phasing
        if (settleStacking(actor)) submit({ type: `complete-${cursor.phase}` }, actor)
      }
    }
  }
  const end = currentScorpionTurn(current().turn, current().turn.step.kind === 'player-turn' ? current() : undefined)
  assert.equal(end.step.kind, 'ended')
  onComplete?.(record)
  return { seed, endTurn: end.number, groundAtEnd: end.weather.ground, vp: end.vp, result: end.step.result, turns,
    attrition, reloads, relocations, blockedEntries, arrivals: current().arrival.placed.length,
    alertsPlaced: current().placedAlerts.length, commands: record.revision }
}
