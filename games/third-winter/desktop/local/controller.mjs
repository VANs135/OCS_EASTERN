import { randomUUID, randomBytes } from 'node:crypto'
import { submitScorpionSession, createScorpionSession } from '../../src/match/scorpion-session.ts'
import { automaticScorpionCaptureOrder } from '../../src/match/scorpion-capture.ts'
import { scorpionStackingChoices } from '../../src/match/scorpion-stacking.ts'
import { verifyRngState } from '@ocs-eastern/series/rng'
import { scorpionSessionBoxFrame } from '../../src/view/scorpion-boxes.ts'
import { scorpionMapStacks } from '../../src/view/scorpion-map-counters.ts'
import { scorpionBarrageMarkerFrame } from '../../src/view/scorpion-barrage-markers.ts'
import { scorpionAuxiliaryCardViews } from '../../src/view/scorpion-auxiliary-cards.ts'
import { scorpionHexAt, scorpionHexLayout } from '../../src/view/scorpion-grid-layout.ts'
import { localChoices, localDecisionSide, localRoster, phaseNames, sideName } from './actions.mjs'
import { actionTarget, localMenu, moveActions, pointActions, retainCounter, routeTo, sidebarChoice } from './interaction.mjs'
import { refitBaseAt, refitBaseOf, refitDraft, toggleRefitSelection } from './refit.mjs'
import { localCombatReview } from './combat-review.mjs'
import { localAidSelection } from './aid-selection.mjs'
import { supplyDraft } from './supply-draft.mjs'
import { localScorpionEnvelope, lockLocalSave, readLocalJson, replaceLocalJson, restoreLocalScorpion } from './store.mjs'

export async function openLocalScorpion(data, savePath, seed = randomBytes(4).readUInt32LE()) {
  const unlock = await lockLocalSave(savePath)
  try {
    const saved = await readLocalJson(savePath)
    const initial = saved === undefined ? createScorpionSession(data.setup, data.assets, seed) : restoreLocalScorpion(saved, data)
    let record = resumeLegacyCapture(initial, data)
    let selection = {}
    let shown = render(record, selection, data)
    let menu = []
    let menuVersion = 0
    if (saved === undefined || record !== initial) await replaceLocalJson(savePath, localScorpionEnvelope(record, data.fingerprint))

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
      const captures = next.state.captureHistory?.slice(record.state.captureHistory?.length ?? 0)
      const picked = captures?.length ? { ...keep, captureNotice: captures.map(captureNotice).join('\n') } : keep
      const nextView = render(next, picked, data)
      await replaceLocalJson(savePath, localScorpionEnvelope(next, data.fingerprint))
      record = next
      selection = picked
      shown = nextView
      return shown
    }

    function pickUnit(unitId, base) {
      const unit = shown.roster.find(({ id }) => id === unitId)
      if (!unit) throw new Error('请选择当前一方的算子')
      const state = record.state
      if (state.kind === 'playing' && state.cursor.phase === 'aircraft-refit') {
        const piece = state.pieces.find((candidate) => candidate.id === unitId)
        const at = base ?? refitBaseOf(state, shown.actor, piece)
        if (!at) throw new Error('这架飞机不在可整备的机场或地图外空军盒')
        const unitIds = toggleRefitSelection(state, shown.actor, at, shown.unitIds, unitId)
        const primary = shown.roster.find(({ id }) => id === unitIds.at(-1))
        selection = { ...selection, refitBase: at, unitId: primary?.id, unitIds, hex: primary?.hex ?? selection.hex, stackHex: undefined }
        return
      }
      const group = (id) => state.kind === 'playing' && (state.units[id] ? 'ground' :
        state.pieces.some((piece) => piece.id === id && piece.kind === 'aircraft') ? 'air' : null)
      const kind = group(unitId)
      const sameGroup = kind ? shown.unitIds.filter((id) => group(id) === kind) : []
      const unitIds = shown.unitIds.includes(unitId)
        ? shown.unitIds.filter((id) => id !== unitId) : [...sameGroup, unitId]
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
      if (shown.combatPrompt && request.kind === 'board-left') {
        const hit = hitAt(request)
        const choice = hit && shown.actions.find((entry) => (entry.mapUnit && entry.mapUnit === hit.unitId) ||
          (entry.mapHex && entry.mapHex === hit.hex))
        if (choice) selection.combatReview = choice.reviewDraft
        else return shown
      } else if (request.kind === 'aid-left') {
        if (shown.combatPrompt) return shown
        const next = { aidCounterId: request.counterId }
        const view = render(record, next, data)
        if (!view.aidPrompt) return shown
        selection = next
        shown = view
        return shown
      } else if (request.kind === 'select-unit') {
        pickUnit(request.unitId, request.base)
      } else if (request.kind === 'board-left') {
        const hit = hitAt(request)
        if (!hit) return shown
        if (shown.aidPrompt) {
          if (shown.aidTargets.includes(hit.hex)) selection = { ...selection, hex: hit.hex }
          else return shown
          shown = render(record, selection, data)
          return shown
        }
        const own = hit.unitId && hit.ownIds.includes(hit.unitId)
        // In the refit phase the base itself is the entry point: clicking an airfield hex opens its
        // draft, then each click on an aircraft of that base toggles it into the batch.
        if (state.kind === 'playing' && state.cursor.phase === 'aircraft-refit' && !hit.unitId) {
          const base = refitBaseAt(state, shown.actor, hit)
          if (base) {
            selection = { refitBase: base, unitIds: [], hex: hit.hex }
            shown = render(record, selection, data)
            return shown
          }
        }
        if (own) {
          pickUnit(hit.unitId)
          shown = render(record, selection, data)
          return shown
        }
        const picked = { ...current, hex: hit.hex, route: [] }
        const direct = choicesAt(picked).filter((entry) => entry.actions.length === 1 &&
          pointActions.has(entry.actions[0].type) && actionTarget(entry.actions[0], hit) &&
          (entry.actions[0].type !== 'base-aircraft' || !hit.ownIds.includes(current.unitId)) && available(entry))
        if (!request.confirm && direct.length === 1) return commit(direct[0].actions)
        if (hit.hex) {
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
        selection = { unitIds: [] }
      } else if (request.kind === 'apply' || request.kind === 'command') {
        const chosen = request.kind === 'apply' ? [...shown.actions, ...priorMenu].find(({ key }) => key === request.key) : null
        const action = request.action
        if (!chosen && (request.kind !== 'command' || !action || typeof action.type !== 'string')) throw new Error('这项操作已不可用')
        if (chosen?.reviewDraft) {
          selection.combatReview = chosen.reviewDraft
          shown = render(record, selection, data)
          return shown
        }
        const step = chosen?.actions[0] ?? action
        const id = step.unitId ?? step.headquartersId ?? (step.unitIds?.length === 1 ? step.unitIds[0] : shown.unitId)
        // A refit batches several aircraft at once and closes its draft; keeping one counter selected
        // would reopen a draft for a base that has already refitted this phase.
        if (step.type === 'refit-aircraft') return commit(chosen?.actions ?? [action], {})
        if (step.type === 'feed-units') return commit(chosen?.actions ?? [action],
          { unitId: shown.unitId, unitIds: shown.unitIds, stackHex: selection.stackHex })
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

function resumeLegacyCapture(record, data) {
  const submit = (seat, action) => submitScorpionSession(record, seat, { id: randomUUID(), expectedRevision: record.revision, action },
    data.assets, data.board).record
  const capture = record.state.capture
  if (capture) {
    const retreat = record.state.combat?.retreat
    const route = retreat?.routes[retreat.nextRoute]?.path.slice(retreat.nextStep)
    record = submit(capture.owner, automaticScorpionCaptureOrder(capture, record.state, data.assets, route))
  }
  const retreat = record.state.combat?.retreat
  return retreat ? submit(retreat.side, { type: 'continue-combat-retreat' }) : record
}

function captureNotice(report) {
  const parts = report.transports.map(({ kind, points, tokens }) => `${kind === 'trucks' ? '卡车' : '马车'} ${points} 点、${tokens}T`)
  if (report.dump) parts.push(`补给堆夺取 ${report.dump.taken}T、摧毁 ${report.dump.destroyed}T`)
  if (report.aircraft.length) {
    const eliminated = report.aircraft.filter((plane) => plane.eliminated).length
    parts.push(`飞机位移 ${report.aircraft.length - eliminated} 枚、损失 ${eliminated} 枚`)
  }
  if (report.extenders?.some((unit) => unit.displacedTo)) parts.push('延补队崩溃并位移')
  if (report.hedgehog) parts.push('工事降级')
  return `${report.hex} 自动夺取${parts.length ? ` · ${parts.join('；')}` : ''}`
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
  const roster = localRoster(state, actor, data, selection.refitBase)
  const placement = state.kind === 'setup' || state.cursor.phase === 'reinforcement' && state.window?.stage === 'scheduled'
  const selected = roster.find(({ id }) => id === selection.unitId) ?? (placement && !selection.unitIds ? roster[0] : undefined)
  const picked = { ...selection, unitId: selected?.id, hex: selection.hex ?? selected?.hex }
  const unitIds = selection.unitIds?.filter((id) => roster.some((item) => item.id === id)) ?? (selected ? [selected.id] : [])
  const { catalog } = data.assets
  const frame = scorpionSessionBoxFrame(state, catalog, actor)
  const { mapCounters, aidCounters } = scorpionBarrageMarkerFrame(state, catalog)
  const auxiliaryCards = scorpionAuxiliaryCardViews(state, catalog, frame.inventories)
  const mapStacks = scorpionMapStacks(state, catalog, mapCounters)
  const result = state.kind === 'playing' && (state.victory || state.turn.step.kind === 'ended' && state.turn.step.result)
  const phase = state.kind === 'setup' ? '开局部署' : result ? '对局结束' : state.turn.step.kind !== 'player-turn' ? '先手判定'
    : state.reroll ? '重掷应答' : state.capture ? '夺取应答' : state.barrage ? '射击应答' : state.airMission ? '空军任务'
      : state.combat ? '战斗应答' : phaseNames[state.cursor.phase]
  const stamp = state.kind === 'setup' ? '' : `第 ${state.turn.number} 回合 · `
  const headline = result ? `${stamp}${result.outcome === 'draw' ? '平局' : `${sideName(result.outcome)}${result.level === 'major' ? '大胜' : '小胜'}`}`
    : `${stamp}${sideName(actor)} · ${phase}`
  const validate = (action) => submitScorpionSession(record, actor,
    { id: `preview-choice:${revision}`, expectedRevision: revision, action }, data.assets, data.board)
  const review = state.kind === 'playing' && localCombatReview(state, actor, selection.combatReview, data.assets, validate)
  const aid = selection.aidCounterId && localAidSelection(state, actor, selection,
    [...aidCounters, ...auxiliaryCards['axis-off-map'].counters], data, validate)
  const stacking = state.kind === 'playing' ? scorpionStackingChoices(state, actor) : []
  const choices = review?.choices ?? aid?.choices ?? localChoices(state, actor, { ...picked, unitIds }, data)
  const selectedStack = stacking.find(({ candidates }) => unitIds.length &&
    unitIds.every((id) => candidates.some(({ unitId }) => unitId === id)))
  if (selectedStack) {
    const { hex, re, limit, candidates } = selectedStack
    const left = re - candidates.filter(({ unitId }) => unitIds.includes(unitId)).reduce((sum, unit) => sum + unit.re, 0)
    if (left <= limit) choices.push({ label: `确认移除所选单位 · ${hex}（${re} → ${left} RE）`,
      actions: [{ type: 'settle-stacking', hex, unitIds }] })
  }
  const actionSet = randomUUID()
  const actions = choices
    .filter((entry) => unitIds.length < 2 || entry.actions[0]?.type !== 'ground-move')
    .filter((entry) => !stacking.length || !entry.actions[0]?.type.startsWith('complete-'))
    .map((entry, index) => ({ ...entry, key: `action:${actionSet}:${index}` }))
  const stack = selection.stackHex ? countersAt(mapStacks, selection.stackHex).filter(({ id }) => roster.some((item) => item.id === id)) : []
  const selectedUnit = state.units?.[picked.unitId]
  const route = selectedUnit && picked.route?.length ? [selectedUnit.hex, ...picked.route] : []
  const refit = state.kind === 'playing' && state.cursor.phase === 'aircraft-refit'
    ? refitDraft(state, actor, selection.refitBase, unitIds, data) : null
  const supply = state.kind === 'playing' && phase === '补给' ? supplyDraft(state, actor, unitIds, data) : null
  return { protocolVersion: 1, revision, actor, headline, phase, roster, stack, stacking,
    phaseId: state.kind === 'setup' ? 'setup' : result ? 'ended' : state.turn.step.kind !== 'player-turn' ? 'initiative' : state.cursor.phase,
    turnNumber: state.kind === 'playing' ? state.turn.number : null,
    phasingSide: state.kind === 'playing' && state.turn.step.kind === 'player-turn' && !result ? state.cursor.phasing : null,
    captureNotice: selection.captureNotice, unitId: picked.unitId ?? null, unitIds, hex: picked.hex ?? null,
    route: picked.route ?? [], actions, combatPrompt: review?.prompt, ended: Boolean(result),
    aidPrompt: aid?.prompt, aidTargets: aid?.targets ?? [], supplyLines: supply?.lines ?? [],
    refit: refit && { base: refit.base, baseLabel: refit.baseLabel, level: refit.level, limit: refit.limit, active: refit.active,
      notes: refit.notes, total: refit.total, ready: refit.ready, fenced: refit.fenced, selected: refit.selected,
      payments: refit.payments.map(({ dumpId, tokens }) => ({ dumpId, tokens, label: dumpId.split(':').at(-1) })),
      aircraft: refit.inactive.map((piece) => ({ id: piece.id, label: catalog.definitions.get(piece.definition)?.source.name ?? piece.id })) },
    frame: { ...frame, aidCounters, auxiliaryCards, mapStacks, selectedUnits: review ? actions.flatMap(({ mapUnit }) => mapUnit ? [mapUnit] : []) : unitIds,
      selectedAidCounter: aid?.counterId, selectedHex: !review && picked.hex && scorpionHexLayout(picked.hex),
      targets: (review?.targets ?? aid?.targets ?? []).map(scorpionHexLayout),
      route: route.map(scorpionHexLayout), retreatPaths: review?.paths?.map((path) => path.map(scorpionHexLayout)) } }
}

export function projectLocalScorpion(view) {
  const control = ({ key, label, group, mapHex, mapUnit, actions, reviewDraft }) => ({
    key, label, group, mapHex, mapUnit, kind: reviewDraft ? 'draft' : 'command',
    actionTypes: actions.map(({ type }) => type),
  })
  const actions = view.actions.filter((entry) => entry.reviewDraft || entry.aidChoice ||
    entry.actions[0]?.type === 'feed-units' || sidebarChoice(entry)).map(control)
  const menu = view.menu?.map(control)
  return { ...view, actions, menu }
}
