import { scorpionAirReturnOptions } from '../../src/match/scorpion-air-operations.ts'
import { remainingSteps } from '../../src/match/scorpion-losses.ts'
import { scorpionSpPayment } from '../../src/match/scorpion-sp-payment.ts'
import { scorpionRemnantDestinations } from '../../src/match/scorpion-remnants.ts'

const terrainName = { Open: '开阔地', Village: '村庄', 'Minor City': '小城市', 'Major City': '大城市',
  Hills: '丘陵', Woods: '疏林', Forest: '密林', Rough: '崎岖地', Mountain: '山地', Swamp: '沼泽' }
const sideName = (side) => side === 'axis' ? '轴心' : '苏军'
const baseName = (base) => base.kind === 'hex' ? base.hex : '地图外空军盒'

function counterName(state, data, id) {
  const counter = state.units[id] ?? state.pieces.find((piece) => piece.id === id)
  return data.assets.catalog.definitions.get(counter?.definition)?.source.name ?? id
}

export function repliesFor(state, side, selection, data, add) {
  const { unitId, hex } = selection
  if (state.reroll) {
    add('保留当前骰点', 'resolve-reroll', { decision: 'keep' })
    add('重掷并把算子交给对手', 'resolve-reroll', { decision: 'reroll' })
    return true
  }
  if (state.capture) return true
  if (state.combat?.retreat) {
    add('继续撤退余程', 'continue-combat-retreat')
    return true
  }
  if (state.airfieldCapacityChoice) {
    const { hex, excess } = state.airfieldCapacityChoice
    const eligible = state.pieces.filter((piece) => piece.kind === 'aircraft' && piece.side === side && piece.active && piece.location.hex === hex)
    const preferred = eligible.find((piece) => piece.id === unitId)
    const ids = [...(preferred ? [preferred] : []), ...eligible.filter((piece) => piece !== preferred)].slice(0, excess).map(({ id }) => id)
    add(`设为非激活 · ${ids.map((id) => counterName(state, data, id)).join('、')}`, 'settle-airfield-capacity', { unitIds: ids })
    return true
  }
  if (state.barrage) {
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
  if (state.airMission) {
    airReplies(state, side, unitId, data, add)
    return true
  }
  if (state.combat) {
    combatReplies(state, side, selection, data, add)
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

function combatReplies(state, side, selection, data, add) {
  const battle = state.combat
  const ids = side === battle.attacker ? battle.attackers : battle.defenders
  if (battle.step === 'defender-supply') {
    const participants = ids.map((id) => state.units[id])
    const cost = participants.reduce((sum, unit) => sum + unit.printedRe - unit.stepsLost, 0) > 1 ? 2 : 1
    const ledger = scorpionSpPayment(state, side, data.assets.map)
    for (const { dumpId, tokens } of ledger.available(participants)) if (tokens >= cost) {
      add(`守方补给 · ${dumpId.split(':').at(-1)} 支付 ${cost}T`, 'defend-combat', { payments: [{ dumpId, tokens: cost }] })
    }
    const internalUnitIds = ids.filter((id) => state.units[id].internalStocks !== 'exhausted' && ledger.available([state.units[id]], false)
      .reduce((sum, { tokens }) => sum + tokens, 0) < cost)
    if (internalUnitIds.length) add(`守方部队储备 · ${internalUnitIds.length} 枚`, 'defend-combat', { payments: [], internalUnitIds })
    add('守方免付战斗补给', 'defend-combat', { payments: [] })
  } else if (battle.step.endsWith('-rating')) {
    for (const unitId of ids) add(`用 ${counterName(state, data, unitId)} 的行动值`, 'select-combat-rating', { unitId })
  } else if (battle.step === 'defender-terrain') {
    for (const terrain of data.assets.map.hexes.get(battle.target).terrains) {
      const attackingTerrain = Object.fromEntries(battle.attackers.map((id) => [state.units[id].hex, terrain]))
      add(`选择${terrainName[terrain]}，结算奇袭与战斗`, 'choose-combat-terrain', { terrain, attackingTerrain })
    }
  } else if (battle.step === 'advance') {
    add('放弃战后推进', 'advance-after-combat', { unitIds: [] })
    for (const unitId of ids.filter((id) => state.units[id])) {
      add(`推进 ${counterName(state, data, unitId)} 到 ${battle.target}`, 'advance-after-combat', { unitIds: [unitId] })
    }
  } else {
    combatResultChoices(state, side, ids, selection, data, add)
  }
}

function combatResultChoices(state, side, ids, { hex }, data, add) {
  const battle = state.combat
  const attacker = side === battle.attacker
  const result = attacker ? battle.roll.attacker : battle.roll.defender
  const leader = attacker ? battle.attackerLeader : battle.defenderLeader
  const order = [leader, ...ids.filter((id) => id !== leader)]
  const available = ids.reduce((sum, id) => sum + remainingSteps(state.units[id]), 0)
  const mandatory = Math.min(available, result.loss)
  for (const ignoreDefenderOption of [false, ...(!attacker && battle.defenderMayIgnore && result.option ? [true] : [])]) {
    const optionLosses = ignoreDefenderOption ? 0 : Math.min(available - mandatory, result.option)
    const lossOrder = []
    const remaining = new Map(order.map((id) => [id, remainingSteps(state.units[id])]))
    while (lossOrder.length < mandatory + optionLosses) for (const id of order) {
      if (lossOrder.length === mandatory + optionLosses) break
      if (remaining.get(id) > 0) { lossOrder.push(id); remaining.set(id, remaining.get(id) - 1) }
    }
    const fields = { lossOrder, optionLosses, ignoreDefenderOption, retreats: [] }
    const label = ignoreDefenderOption ? `忽略守方选项，结算 ${lossOrder.length} 步` : `结算 ${lossOrder.length} 步战斗损失`
    const parent = ids.find((id) => {
      if (side !== 'axis' || remaining.get(id)) return false
      const definition = data.assets.catalog.definitions.get(state.units[id].definition)
      const stats = definition.source.faces.combat.stats
      return definition.source.name.startsWith('Ge ') && definition.source.category === 'infantry' &&
        definition.source.re === 4 && stats.attack === 16 && stats.artRange === 4 && stats.move === 3
    })
    const active = Object.values(state.units).filter((unit) => unit.remnantOf).length
    const destinations = parent && active < 2 ? scorpionRemnantDestinations(state, state.units[parent].hex, data.assets) : []
    if (destinations.length > 1) {
      for (const at of destinations.includes(hex) ? [hex] : destinations) add(`${label} · 残部放在 ${at}`, 'resolve-combat',
        { ...fields, remnants: [{ divisionId: parent, hex: at }] })
    } else add(label, 'resolve-combat', fields)
  }
}
