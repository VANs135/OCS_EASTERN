import { randomUUID, randomBytes } from 'node:crypto'
import { submitScorpionSession, createScorpionSession } from '../../src/match/scorpion-session.ts'
import { verifyRngState } from '@ocs-eastern/series/rng'
import { scorpionSessionBoxFrame } from '../../src/view/scorpion-boxes.ts'
import { scorpionMapStacks } from '../../src/view/scorpion-map-counters.ts'
import { scorpionBarrageMarkerFrame } from '../../src/view/scorpion-barrage-markers.ts'
import { scorpionHexAt, scorpionHexLayout } from '../../src/view/scorpion-grid-layout.ts'
import { localChoices, localDecisionSide, localRoster, phaseNames, sideName } from './actions.mjs'
import { localScorpionEnvelope, lockLocalSave, readLocalJson, replaceLocalJson, restoreLocalScorpion } from './store.mjs'

export async function openLocalScorpion(data, savePath, seed = randomBytes(4).readUInt32LE()) {
  const unlock = await lockLocalSave(savePath)
  try {
    const saved = await readLocalJson(savePath)
    let record = saved === undefined ? createScorpionSession(data.setup, data.assets, seed) : restoreLocalScorpion(saved, data)
    let selection = {}
    let shown = render(record, selection, data)
    if (saved === undefined) await replaceLocalJson(savePath, localScorpionEnvelope(record, data.fingerprint))
    async function dispatch(request) {
      const state = record.state
      if (request?.kind === 'view') return shown
      if (request?.revision !== record.revision) throw new Error('局面已更新，请重新选择')
      if (request.kind === 'select-unit') {
        const selected = shown.roster.find(({ id }) => id === request.unitId)
        if (!selected) throw new Error('请选择当前一方的算子')
        selection = { unitId: selected.id, hex: selected.hex, route: [] }
      } else if (request.kind === 'select-hex') {
        const hex = scorpionHexAt(request.x, request.y)
        if (!hex || !data.assets.map.hexes.has(hex)) return shown
        const unit = state.units?.[shown.unitId]
        const steps = selection.route ?? []
        const from = steps.at(-1) ?? unit?.hex
        const route = unit && ['movement', 'reaction', 'exploitation'].includes(state.cursor.phase) && from !== hex &&
          data.assets.map.neighbors(from).includes(hex) && !steps.includes(hex) && hex !== unit.hex ? [...steps, hex] : []
        selection = { unitId: shown.unitId, hex, route }
      } else if (request.kind === 'clear-route') {
        selection = { unitId: shown.unitId, route: [] }
      } else if (request.kind === 'apply' || request.kind === 'command') {
        const chosen = request.kind === 'apply' ? shown.actions.find(({ key }) => key === request.key) : null
        const action = request.action
        if (!chosen && (request.kind !== 'command' || !action || typeof action.type !== 'string')) throw new Error('这项操作已不可用')
        let next = record
        for (const step of chosen?.actions ?? [action]) {
          next = submitScorpionSession(next, shown.actor, { id: randomUUID(), expectedRevision: next.revision, action: step }, data.assets, data.board).record
        }
        const rng = next.state.kind === 'setup' ? next.state.opening.rng : next.state.rng
        if (!verifyRngState(rng)) throw new Error('骰序无法保存')
        const nextView = render(next, {}, data)
        await replaceLocalJson(savePath, localScorpionEnvelope(next, data.fingerprint))
        record = next
        shown = nextView
        selection = {}
        return shown
      } else throw new Error('无法识别此操作')
      shown = render(record, selection, data)
      return shown
    }
    return { dispatch, view: () => shown, close: unlock }
  } catch (error) {
    await unlock()
    throw error
  }
}

function render(record, selection, data) {
  const { state, revision } = record
  const actor = localDecisionSide(state) ?? (state.kind === 'playing' ? state.cursor.phasing : state.opening.seat)
  const roster = localRoster(state, actor, data)
  const selected = roster.find(({ id }) => id === selection.unitId) ?? (state.kind === 'setup' ? roster[0] :
    state.cursor.phase === 'reinforcement' && state.window?.stage === 'scheduled' ? roster[0] : undefined)
  const picked = { ...selection, unitId: selected?.id, hex: selection.hex ?? selected?.hex }
  const { catalog } = data.assets
  const frame = scorpionSessionBoxFrame(state, catalog, actor)
  const { mapCounters, aidCounters } = scorpionBarrageMarkerFrame(state, catalog)
  const mapStacks = scorpionMapStacks(state, catalog, mapCounters)
  const result = state.kind === 'playing' && (state.victory || state.turn.step.kind === 'ended' && state.turn.step.result)
  const phase = state.kind === 'setup' ? '开局部署' : result ? '对局结束' : state.turn.step.kind !== 'player-turn' ? '先手判定'
    : state.reroll ? '重掷应答' : state.capture ? '夺取应答' : state.barrage ? '射击应答' : state.airMission ? '空军任务'
      : state.combat ? '战斗应答' : phaseNames[state.cursor.phase]
  const stamp = state.kind === 'setup' ? '' : `第 ${state.turn.number} 回合 · `
  const headline = result ? `${stamp}${result.outcome === 'draw' ? '平局' : `${sideName(result.outcome)}${result.level === 'major' ? '大胜' : '小胜'}`}`
    : `${stamp}${sideName(actor)} · ${phase}`
  const actions = localChoices(state, actor, picked, data).map((entry, index) => ({ ...entry, key: String(index) }))
  const selectedUnit = state.units?.[picked.unitId]
  const route = selectedUnit && picked.route?.length ? [selectedUnit.hex, ...picked.route] : []
  return { revision, actor, headline, phase, roster, unitId: picked.unitId ?? null, hex: picked.hex ?? null,
    route: picked.route ?? [], actions, ended: Boolean(result),
    frame: { ...frame, aidCounters, mapStacks, selectedUnit: picked.unitId, selectedHex: picked.hex && scorpionHexLayout(picked.hex),
      route: route.map(scorpionHexLayout) } }
}

export function projectLocalScorpion(view) {
  return { ...view, actions: view.actions.map(({ key, label }) => ({ key, label })) }
}
