import { scorpionBarrageFronts } from '../../src/ttw/scorpion/barrage-markers.ts'
import { frontBarrageDraft, frontChoices } from './barrage-draft.mjs'

export function localAidSelection(state, side, selection, counters, data, validate) {
  if (state.kind !== 'playing' || state.reroll || state.capture || state.airMission ||
    state.combat || state.barrage || state.victory || state.airfieldCapacityChoice ||
    state.turn.step.kind !== 'player-turn') return null
  const counter = counters.find(({ id }) => id === selection.aidCounterId)
  if (!counter) return null
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
