import { verifyRngState } from '@ocs-eastern/series/rng'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionSessionBoxFrame } from '../src/view/scorpion-boxes.ts'
import { prepareScorpionDemoSupply } from './scorpion-demo-commands.mjs'

export function sampleScorpionReroll(opening, assets, board) {
  const prepared = prepareScorpionDemoSupply(opening, assets, board)
  const issue = (record, side, action) => submitScorpionSession(record, side, {
    id: `sample-reroll-${record.revision}`, expectedRevision: record.revision, action,
  }, assets, board).record
  const initial = issue(prepared, 'soviet', { type: 'finish-scheduled-arrivals' })
  if (initial.state.reroll?.current.site.kind !== 'supply' || initial.state.rerollHolder !== 'soviet') {
    throw new Error('Soviet reinforcement must stop at its supply dice')
  }
  const transferred = issue(initial, 'soviet', { type: 'resolve-reroll', decision: 'reroll' })
  const restored = JSON.parse(JSON.stringify(transferred))
  const settled = issue(restored, 'axis', { type: 'resolve-reroll', decision: 'keep' })
  const replacement = transferred.state.reroll.current.draw.value.faces
  const marker = scorpionSessionBoxFrame(settled.state, assets.catalog).reroll
  if (settled.state.reroll || marker?.holder !== 'axis' || marker.asset !== 'reroll.png' ||
    settled.state.window.dice.some((die, index) => die !== replacement[index]) || !verifyRngState(settled.state.rng)) {
    throw new Error('The reroll marker, saved dice and supply award disagree')
  }
  return { initial, transferred, settled, report: { first: initial.state.reroll.current.draw.value.faces,
    replacement, sp: settled.state.window.variableTokens / 4, holder: marker.holder, asset: marker.asset } }
}
