import { scorpionAirReturnOptions } from '../../src/match/scorpion-air-operations.ts'
import { scorpionPendingAirDecision } from '../../src/match/scorpion-air-actions.ts'
import { scorpionPendingCombatDecision } from '../../src/match/scorpion-combat-actions.ts'
import { breakdownDraftEntry } from './breakdown-draft.mjs'
import { remainingSteps } from '../../src/match/scorpion-losses.ts'
import { scorpionSpPayment } from '../../src/match/scorpion-sp-payment.ts'
import { advanceChoices, advanceDraft, defenseSupplyChoices, defenseSupplyDraft, terrainChoices, terrainDraft } from './combat-draft.mjs'

const terrainName = { Open: '开阔地', Village: '村庄', 'Minor City': '小城市', 'Major City': '大城市',
  Hills: '丘陵', Woods: '疏林', Forest: '密林', Rough: '崎岖地', Mountain: '山地', Swamp: '沼泽' }
const sideName = (side) => side === 'axis' ? '轴心' : '苏军'
const baseName = (base) => base.kind === 'hex' ? base.hex : '地图外空军盒'

function counterName(state, data, id) {
  const counter = state.units[id] ?? state.pieces.find((piece) => piece.id === id)
  return data.assets.catalog.definitions.get(counter?.definition)?.source.name ?? id
}

export function repliesFor(state, side, selection, data, add, addDraft) {
  const { unitId } = selection
  if (state.reroll) {
    add('保留当前骰点', 'resolve-reroll', { decision: 'keep' })
    add('重掷并把算子交给对手', 'resolve-reroll', { decision: 'reroll' })
    return true
  }
  if (state.phaseClose) {
    if (state.phaseClose.actor === side) for (const pair of state.phaseClose.options) {
      add(`${counterName(state, data, pair.parentId)} 吸收 ${counterName(state, data, pair.breakdownId)}`, 'absorb-breakdown', pair)
    }
    return true
  }
  if (state.capture) return true
  if (state.combat?.retreat) {
    add('继续撤退余程', 'continue-combat-retreat')
    return true
  }
  const air = scorpionPendingAirDecision(state)
  if (air?.kind === 'airfield-capacity') {
    const { hex, excess } = state.airfieldCapacityChoice
    const eligible = state.pieces.filter((piece) => piece.kind === 'aircraft' && piece.side === side && piece.active && piece.location.hex === hex)
    const preferred = eligible.find((piece) => piece.id === unitId)
    const ids = [...(preferred ? [preferred] : []), ...eligible.filter((piece) => piece !== preferred)].slice(0, excess).map(({ id }) => id)
    add(`设为非激活 · ${ids.map((id) => counterName(state, data, id)).join('、')}`, 'settle-airfield-capacity', { unitIds: ids })
    return true
  }
  if (air?.kind === 'barrage') {
    const event = state.barrage
    if (!event.roll) for (const terrain of data.assets.map.hexes.get(event.target).terrains) {
      add(`以${terrainName[terrain]}结算射击`, 'choose-barrage-terrain', { terrain })
    }
    else {
      const ids = event.lossCandidates ?? Object.keys(state.units).filter((id) => state.units[id].side === side &&
        state.units[id].combat && state.units[id].hex === event.target)
      for (const id of ids) {
        let remaining = event.lossesDue
        const allocation = [id, ...ids.filter((other) => other !== id)].flatMap((unitId) => {
          const steps = Math.min(remaining, remainingSteps(state.units[unitId]))
          remaining -= steps
          return steps ? [{ unitId, steps }] : []
        })
        if (!remaining) add(`分配 ${event.lossesDue} 步射击损失 · 优先 ${counterName(state, data, id)}`, 'assign-barrage-loss', { allocation })
      }
    }
    return true
  }
  if (air?.kind === 'air-mission') {
    airReplies(state, side, unitId, data, add)
    return true
  }
  if (state.combat) {
    const decision = scorpionPendingCombatDecision(state)
    if (decision?.actor === side) combatReplies(state, side, decision.actionType, data, add, addDraft)
    return true
  }
  const step = state.turn.step
  if (['retention', 'roll'].includes(step.kind)) {
    if (step.kind === 'retention') for (const [dumpId, dump] of Object.entries(state.dumps)) {
      if (dump.side === side && dump.location === 'on-map' && dump.tokens >= 4) {
        add(`保留先手 · ${dumpId.split(':').at(-1)} 支付 1 SP`, 'retain-initiative', { dumpId })
      }
    }
    add('掷骰决定先手', 'roll-initiative')
    return true
  }
  if (step.kind === 'choose-order') {
    for (const first of ['axis', 'soviet']) add(`选择${sideName(first)}先行动`, 'choose-first', { first })
    return true
  }
  return false
}

function airReplies(state, side, unitId, data, add) {
  const { target, step, returning } = state.airMission
  const active = state.pieces.filter((piece) => piece.side === side && piece.kind === 'aircraft' && piece.active &&
    piece.location.kind === target.kind && piece.location.hex === target.hex)
  if (step.kind === 'interception') {
    add('放弃拦截', 'respond-interception', { unitId: null })
    for (const unitId of step.candidates) add(`拦截 · ${counterName(state, data, unitId)}`, 'respond-interception', { unitId })
  } else if (step.kind === 'combat-aborts') {
    add('保留所有飞机继续', 'choose-air-aborts', { unitIds: [] })
    if (step.afterCombat || active.length > 1) for (const { id } of active) {
      add(`撤回 ${counterName(state, data, id)}`, 'choose-air-aborts', { unitIds: [id] })
    }
  } else if (step.kind === 'pick-attacker' || step.kind === 'pick-defender') {
    for (const { id } of active) add(`${step.kind === 'pick-attacker' ? '选攻击机' : '选防守机'} · ${counterName(state, data, id)}`,
      'choose-air-combat-unit', { unitId: id })
  } else if (step.kind === 'flak-loss') {
    for (const id of step.candidates) add(`分配防空损失 · ${counterName(state, data, id)}`, 'choose-flak-loss', { unitId: id })
  } else if (step.kind === 'return') {
    for (const id of returning) for (const base of scorpionAirReturnOptions(state, side, id, data.assets)) {
      add(`${counterName(state, data, id)} 返航到 ${baseName(base)}`, 'return-aircraft', { unitId: id, base })
    }
  } else if (step.kind === 'airdrop-cargo') {
    for (const { choice, attempts, saved } of step.options) add(`${choice === 'drop' ? '继续空投' : '中止空投'} · ${attempts}T 投放 / ${saved}T 保留`,
      'choose-airdrop-cargo', { disposition: choice })
  } else if (step.kind === 'airlift-landing') {
    add('所有飞机返航，结算可卸载货物', 'choose-airlift-landing', { unitIds: [] })
    for (const id of step.candidates) add(`由 ${counterName(state, data, id)} 留场卸载`, 'choose-airlift-landing', { unitIds: [id] })
  } else if (step.kind === 'airlift-cargo') {
    add(`保留 ${Math.min(step.tokens, step.capacity)}T 补给`, 'choose-airlift-cargo', { cargo: { tokens: Math.min(step.tokens, step.capacity), unitIds: [] } })
  }
}

function combatReplies(state, side, actionType, data, add, addDraft) {
  const battle = state.combat
  const ids = side === battle.attacker ? battle.attackers : battle.defenders
  const counterNameOf = (id) => counterName(state, data, id)
  if (actionType === 'defend-combat') {
    const draft = defenseSupplyDraft(state, side, data, ids)
    for (const row of defenseSupplyChoices(draft)) add(row.label, row.type, { payments: row.payments, internalUnitIds: row.internalUnitIds })
  } else if (actionType === 'select-combat-rating') {
    for (const unitId of ids) add(`用 ${counterName(state, data, unitId)} 的行动值`, 'select-combat-rating', { unitId })
  } else if (actionType === 'choose-combat-terrain') {
    // Each attacking origin names its own terrain or the river it crosses on the way in.
    const draft = terrainDraft(state, side, data)
    if (draft) for (const row of terrainChoices(draft)) add(row.label, row.type, { terrain: row.terrain, attackingTerrain: row.attackingTerrain })
    else for (const terrain of data.assets.map.hexes.get(battle.target).terrains) {
      const attackingTerrain = Object.fromEntries(battle.attackers.map((id) => [state.units[id].hex, terrain]))
      add(`选择${terrainName[terrain]}，结算奇袭与战斗`, 'choose-combat-terrain', { terrain, attackingTerrain })
    }
  } else if (actionType === 'advance-after-combat') {
    const draft = advanceDraft(state, side)
    for (const row of advanceChoices(draft, counterNameOf)) {
      add(row.label, row.type, { unitIds: row.unitIds })
      if (row.unitIds.reduce((total, id) => total + remainingSteps(state.units[id]), 0) > draft.room) continue
      const entry = breakdownDraftEntry(state, side, { type: actionType, unitIds: row.unitIds }, row.label, data.assets)
      if (entry) addDraft(entry)
    }
  }
}
