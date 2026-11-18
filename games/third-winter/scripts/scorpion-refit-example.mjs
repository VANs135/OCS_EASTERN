import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionSpPayment } from '../src/match/scorpion-sp-payment.ts'

export function sampleScorpionRefit(start, assets) {
  const side = start.state.cursor.phasing
  const aircraft = start.state.pieces.filter((piece) => piece.side === side && piece.kind === 'aircraft')
  const offMap = aircraft.find((piece) => piece.location.kind === 'off-map-air')
  const onMap = aircraft.find((piece) => piece.location.kind === 'hex')
  if (!offMap || !onMap) throw new Error('Missing on-map or off-map aircraft in the printed opening example')
  const { hex } = onMap.location
  const { position, network } = scorpionSpPayment(start.state, side, assets.map)
  const prefix = `${side}:hex:`
  const payment = !position.unnegatedEnemyZoc.has(hex) && Object.entries(start.state.dumps).find(([id, dump]) =>
    id.startsWith(prefix) && dump.side === side && dump.location === 'on-map' && dump.tokens > 0 &&
    network.canUseDump(hex, id.slice(prefix.length)))
  const unitIds = new Set(payment ? [offMap.id, onMap.id] : [offMap.id])
  const before = { ...start, state: { ...start.state, pieces: start.state.pieces.map((piece) =>
    unitIds.has(piece.id) ? { ...piece, active: false } : piece) } }
  const submit = (record, base, id) => submitScorpionSession(record, side, {
    id: `refit-example-${record.revision}`, expectedRevision: record.revision,
    action: { type: 'refit-aircraft', base, unitIds: [id] },
  }, assets).record
  const offMapRefitted = submit(before, { kind: 'off-map-air' }, offMap.id)
  const after = payment ? submit(offMapRefitted, { kind: 'hex', hex, dumpId: payment[0] }, onMap.id) : offMapRefitted
  return { before, after, offMap: offMap.id, airBase: payment ? hex : null,
    spent: payment ? payment[1].tokens - after.state.dumps[payment[0]].tokens : 0 }
}
