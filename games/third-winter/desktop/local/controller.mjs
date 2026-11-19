import { randomUUID, randomBytes } from 'node:crypto'
import { submitScorpionSession, createScorpionSession } from '../../src/match/scorpion-session.ts'
import { verifyRngState } from '@ocs-eastern/series/rng'
import { scorpionSessionBoxFrame } from '../../src/view/scorpion-boxes.ts'
import { scorpionMapStacks } from '../../src/view/scorpion-map-counters.ts'
import { scorpionBarrageMarkerFrame } from '../../src/view/scorpion-barrage-markers.ts'
import { scorpionHexAt, scorpionHexLayout } from '../../src/view/scorpion-grid-layout.ts'
import { localChoices, localDecisionSide, localRoster, phaseNames, sideName } from './actions.mjs'
import { actionTarget, localMenu, moveActions, pointActions, retainCounter, routeTo, sidebarChoice } from './interaction.mjs'
import { localScorpionEnvelope, lockLocalSave, readLocalJson, replaceLocalJson, restoreLocalScorpion } from './store.mjs'

export async function openLocalScorpion(data, savePath, seed = randomBytes(4).readUInt32LE()) {
  const unlock = await lockLocalSave(savePath)
  try {
    const saved = await readLocalJson(savePath)
    let record = saved === undefined ? createScorpionSession(data.setup, data.assets, seed) : restoreLocalScorpion(saved, data)
    let selection = {}
    let shown = render(record, selection, data)
    let menu = []
    let menuVersion = 0
    if (saved === undefined) await replaceLocalJson(savePath, localScorpionEnvelope(record, data.fingerprint))

    function run(steps, preview = false) {
      return steps.reduce((next, action, i) => submitScorpionSession(next, shown.actor, {
        id: preview ? `preview:${record.revision}:${i}` : randomUUID(), expectedRevision: next.revision, action,
      }, data.assets, data.board).record, record)
    }

    function available({ actions }) {
      try { run(actions, true); return true } catch { return false }
    }

    async function commit(steps, keep = {}) {
      const next = run(steps)
      const rng = next.state.kind === 'setup' ? next.state.opening.rng : next.state.rng
      if (!verifyRngState(rng)) throw new Error('骰序无法保存')
      const nextView = render(next, keep, data)
      await replaceLocalJson(savePath, localScorpionEnvelope(next, data.fingerprint))
      record = next
      selection = keep
      shown = nextView
      return shown
    }

    function pickUnit(unitId, toggle) {
      const unit = shown.roster.find(({ id }) => id === unitId)
      if (!unit) throw new Error('请选择当前一方的算子')
      const multi = toggle && record.state.units?.[unitId]
      const current = shown.unitIds.filter((id) => record.state.units?.[id])
      const unitIds = multi ? current.includes(unitId) ? current.filter((id) => id !== unitId) : [...current, unitId] : [unitId]
      const primary = shown.roster.find(({ id }) => id === unitIds.at(-1))
      selection = { unitId: primary?.id, unitIds, hex: primary?.hex, stackHex: selection.stackHex === unit.hex ? unit.hex : undefined }
    }

    function hitAt(request) {
      const box = shown.frame.inventories.find((entry) => entry.cell === request.cell && !entry.hidden)
      if (request.cell !== undefined && !box) return null
      const hex = !box && scorpionHexAt(request.x, request.y)
      if (!box && (!hex || !data.assets.map.hexes.has(hex))) return null
      const counters = box ? box.counters : countersAt(shown.frame.mapStacks, hex)
      const unitId = counters.find(({ id }) => id === request.unitId)?.id
      const ownIds = counters.filter(({ id }) => shown.roster.some((unit) => unit.id === id)).map(({ id }) => id)
      return { hex: hex || undefined, unitId, ownIds, box: box?.cell === (shown.actor === 'axis' ? 20 : 26),
        labels: Object.fromEntries(counters.map(({ id, label }) => [id, label])) }
    }

    async function dispatch(request) {
      const state = record.state
      if (request?.kind === 'view') return shown
      if (request?.revision !== record.revision) throw new Error('局面已更新，请重新选择')
      const choicesAt = (picked) => localChoices(state, shown.actor, picked, data)
      const current = { ...selection, unitId: shown.unitId, unitIds: shown.unitIds }
      if (request.kind === 'board-menu' || request.kind === 'counter-menu') {
        const hit = request.kind === 'board-menu' ? hitAt(request) : rosterHit(shown, request.unitId)
        const version = ++menuVersion
        menu = hit ? localMenu(state, shown.actor, current, hit, data, choicesAt).filter(available)
          .map((entry, i) => ({ ...entry, key: `menu:${version}:${i}` })) : []
        return { ...shown, menu }
      }
      const priorMenu = menu
      menu = []
      if (request.kind === 'select-unit') {
        pickUnit(request.unitId, request.toggle)
      } else if (request.kind === 'board-left') {
        const hit = hitAt(request)
        if (!hit) return shown
        const own = hit.unitId && hit.ownIds.includes(hit.unitId)
        const picked = { ...current, hex: hit.hex, route: [] }
        const direct = choicesAt(picked).filter((entry) => entry.actions.length === 1 &&
          pointActions.has(entry.actions[0].type) && actionTarget(entry.actions[0], hit) &&
          (entry.actions[0].type !== 'base-aircraft' || !hit.ownIds.includes(current.unitId)) && available(entry))
        if (!request.confirm && direct.length === 1 && (!hit.box || !own)) return commit(direct[0].actions)
        if (own && (!request.confirm || !current.route?.length)) {
          pickUnit(hit.unitId, request.toggle)
          selection.stackHex = undefined
        } else if (hit.hex) {
          const route = routeTo(state, current, hit.hex, data.assets.map)
          selection = { ...current, hex: hit.hex, route, stackHex: !route.length && hit.ownIds.length > 0 ? hit.hex : undefined }
          if (request.confirm && route.length) {
            const choice = choicesAt(selection).find((item) => {
              const { type } = item.actions[0]
              return moveActions.has(type) && sidebarChoice(item) &&
                (type !== 'ground-move' || current.unitIds.length === 1) && available(item)
            })
            if (choice) return commit(choice.actions)
          }
        }
      } else if (request.kind === 'clear-selection') {
        selection = {}
      } else if (request.kind === 'apply' || request.kind === 'command') {
        const chosen = request.kind === 'apply' ? [...shown.actions, ...priorMenu].find(({ key }) => key === request.key) : null
        const action = request.action
        if (!chosen && (request.kind !== 'command' || !action || typeof action.type !== 'string')) throw new Error('这项操作已不可用')
        const step = chosen?.actions[0] ?? action
        const id = step.unitId ?? step.headquartersId ?? (step.unitIds?.length === 1 ? step.unitIds[0] : shown.unitId)
        const keep = retainCounter(step) && id ? { unitId: id, unitIds: [id], stackHex: selection.stackHex } : {}
        return commit(chosen?.actions ?? [action], keep)
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

function countersAt(stacks, hex) {
  return stacks.find((stack) => stack.hex === hex)?.pages.flat() ?? []
}

function rosterHit(shown, id) {
  const unit = shown.roster.find((item) => item.id === id)
  return unit && { unitId: id, ownIds: [id], hex: unit.hex, labels: { [id]: unit.label } }
}

function render(record, selection, data) {
  const { state, revision } = record
  const actor = localDecisionSide(state) ?? (state.kind === 'playing' ? state.cursor.phasing : state.opening.seat)
  const roster = localRoster(state, actor, data)
  const selected = roster.find(({ id }) => id === selection.unitId) ?? (state.kind === 'setup' ? roster[0] :
    state.cursor.phase === 'reinforcement' && state.window?.stage === 'scheduled' ? roster[0] : undefined)
  const picked = { ...selection, unitId: selected?.id, hex: selection.hex ?? selected?.hex }
  const unitIds = selection.unitIds?.filter((id) => roster.some((item) => item.id === id)) ?? (selected ? [selected.id] : [])
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
  const actions = localChoices(state, actor, { ...picked, unitIds }, data)
    .filter((entry) => unitIds.length < 2 || entry.actions[0].type !== 'ground-move')
    .map((entry, index) => ({ ...entry, key: String(index) }))
  const stack = selection.stackHex ? countersAt(mapStacks, selection.stackHex).filter(({ id }) => roster.some((item) => item.id === id)) : []
  const selectedUnit = state.units?.[picked.unitId]
  const route = selectedUnit && picked.route?.length ? [selectedUnit.hex, ...picked.route] : []
  return { revision, actor, headline, phase, roster, stack, unitId: picked.unitId ?? null, unitIds, hex: picked.hex ?? null,
    route: picked.route ?? [], actions, ended: Boolean(result),
    frame: { ...frame, aidCounters, mapStacks, selectedUnits: unitIds, selectedHex: picked.hex && scorpionHexLayout(picked.hex),
      route: route.map(scorpionHexLayout) } }
}

export function projectLocalScorpion(view) {
  const actions = view.actions.filter(sidebarChoice).map(({ key, label }) => ({ key, label }))
  const menu = view.menu?.map(({ key, label, group }) => ({ key, label, group }))
  return { ...view, actions, menu }
}
