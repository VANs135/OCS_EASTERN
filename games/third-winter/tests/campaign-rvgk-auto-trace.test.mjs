import assert from 'node:assert/strict'
import test from 'node:test'
import { campaignGroundPosition } from '../src/match/campaign-ground-position.ts'
import { rvgkAutoTraceSupply, rvgkConsolidationAllowed } from '../src/ttw/rvgk.ts'

const map = { resolveHex: (hex) => hex, neighbors: () => [] }
const profile = { combat: true, attackCapable: true, inCombatMode: true, outOfSupply: false,
  moveMa: 10, moveMobility: 'truck', drawMobility: 'truck', singleTransportPoint: false }
const profileOf = () => profile
const state = { counters: {
  onmap: { definition: 'd', kind: 'land', side: 'soviet', location: { kind: 'map', hex: '10' } },
  inbox: { definition: 'd', kind: 'land', side: 'soviet', location: { kind: 'box', box: 'rvgk-1' } },
} }

test('RVGK box units are automatically in trace supply by being off the map supply position (§3.5c)', () => {
  assert.equal(rvgkAutoTraceSupply(), true)
  assert.equal(rvgkConsolidationAllowed(), false)
  const position = campaignGroundPosition(state, 'soviet', map, profileOf)
  // on-map combat unit enters the supply ground position; the RVGK-box unit does not,
  // so it is neither fed nor attritioned in the supply phase — i.e. automatically in trace.
  assert.ok(position.friendly.has('onmap'))
  assert.equal(position.friendly.has('inbox'), false)
})