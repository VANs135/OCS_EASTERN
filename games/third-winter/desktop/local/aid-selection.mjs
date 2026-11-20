import { scorpionBarrageFronts } from '../../src/ttw/scorpion/barrage-markers.ts'
import { frontBarrageDraft, frontChoices } from './barrage-draft.mjs'
import { scorpionKesselTargets, scorpionKesselWindow } from '../../src/match/scorpion-kessel.ts'

export function localAidSelection(state, side, selection, counters, data, validate) {
  if (state.kind !== 'playing' || state.reroll || state.capture || state.airMission ||
    state.combat || state.barrage || state.victory || state.airfieldCapacityChoice ||
    state.turn.step.kind !== 'player-turn') return null
  const counter = counters.find(({ id }) => id === selection.aidCounterId)
  if (!counter) return null
  if (counter.id.startsWith('kessel-box:')) return kesselDraft(state, side, selection, counter, validate)
  const front = scorpionBarrageFronts.find((value) => counter.id === `artillery:${value}`)
  if (!front) return null

  const draft = frontBarrageDraft(state, side, data, front, selection.hex)
  const choices = frontChoices(draft).flatMap(({ label, ...action }) => {
    try { validate(action) } catch { return [] }
    return [{ label, actions: [action], aidChoice: true }]
  })
  const message = !selection.hex && draft.centers.length ? '切回小地图，左键选择标出的中心格' :
    draft.reason ?? (choices.length ? '选择司令部和射击方案' : '这个中心格没有可提交的射击方案')
  return { counterId: counter.id, prompt: `${counter.label} · ${message}`, targets: draft.centers, choices }
}

function kesselDraft(state, side, selection, counter, validate) {
  const definition = counter.id.slice('kessel-box:'.length)
  const orders = scorpionKesselWindow(state, side) ? scorpionKesselTargets(state).flatMap((hex) => {
    const action = { type: 'place-kessel-hq', definition, hex }
    try { validate(action) } catch { return [] }
    return [action]
  }) : []
  const targets = orders.map(({ hex }) => hex)
  const action = orders.find(({ hex }) => hex === selection.hex)
  const reason = action ? `确认放置到 ${action.hex}` : targets.length ? '切回小地图，左键选择合法落点' :
    scorpionKesselWindow(state, side) ? '当前没有合法落点' : '只可在轴心增援阶段放置'
  return { counterId: counter.id, prompt: `${counter.label} · ${reason}`, targets,
    choices: action ? [{ label: `放置到 ${action.hex}`, actions: [action], aidChoice: true }] : [] }
}
