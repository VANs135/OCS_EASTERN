import assert from 'node:assert/strict'
import { test } from 'node:test'
import { combatStrengthFromFacts, combatTerrainCategory } from '../src/ttw/combat-terrain.ts'
import {
  ARMY_GROUP_HQ_DESTROYED_VP, ARMY_HQ_DESTROYED_VP, BARRAGE_MARKER_RECOVERY_TURNS, BRIDGEHEAD_TURN_RE_LIMIT,
  DEFENSIVE_BARRAGE_COLUMN_LABEL, DEFENSIVE_FRONT_ATTACK_SUPPLY_CAP, VOLGA_ADVANCE_RE_LIMIT,
  armyGroupDestroyedCombatDrm, armyGroupDrmEligible, assaultUnitActionRating, barrageMarkerRecoveryTurn,
  barrageMarkerUsable, bridgeheadAttackStrength, bridgeheadEligible, corpsHqRecoveryRoll, defensivePostureArModifier,
  defensivePostureQualifies, destroyedOnForcedRetreat, khersonAttackEligible, mountainUnitArModifier,
  railwayGunCanBarrage, remnantDestinations, remnantGenerationEligible, remnantRebuildEligible,
  volgaAttackEligible, volgaFerryAttackFactor, volgaRetreatEligible,
} from '../src/ttw/combat-special.ts'

const strength = (patch = {}) => ({
  attacking: true, terrain: 'Open', frozen: false, supplied: true, enemyAntiTank: 0,
  combatClass: 'other', strength: 6, printedRe: 3, stepsLost: 0, antiTank: 0, outOfSupply: false,
  artilleryDivision: false, attackFactor: 1, defenseFactor: 1, ...patch,
})

test('the shared TEC maps terrain to CRT categories (TTW TEC)', () => {
  assert.equal(combatTerrainCategory('Open'), 'Open')
  assert.equal(combatTerrainCategory('Rough'), 'Very Close')
  assert.equal(combatTerrainCategory('Minor City'), 'Very Close')
  assert.equal(combatTerrainCategory('Mountain'), 'Extr Close')
})

test('armor attacking open doubles, reduced to 1.5 against equal anti-tank (TTW TEC)', () => {
  assert.equal(combatStrengthFromFacts(strength({ combatClass: 'armor' })), 12)
  assert.equal(combatStrengthFromFacts(strength({ combatClass: 'armor', antiTank: 1, enemyAntiTank: 2 })), 9)
  assert.equal(combatStrengthFromFacts(strength({ combatClass: 'armor', antiTank: 1, enemyAntiTank: 1 })), 9)
  assert.equal(combatStrengthFromFacts(strength({ combatClass: 'armor', enemyAntiTank: 2 })), 12)
})

test('step losses halve attack always and defense only at half printed (OCS 9.11d)', () => {
  assert.equal(combatStrengthFromFacts(strength({ stepsLost: 1 })), 3)
  assert.equal(combatStrengthFromFacts(strength({ attacking: false, printedRe: 4, stepsLost: 1 })), 6)
  assert.equal(combatStrengthFromFacts(strength({ attacking: false, printedRe: 4, stepsLost: 2 })), 3)
})

test('artillery divisions defend at current RE without the step-loss halving (TTW 1.6d)', () => {
  const arty = strength({ attacking: false, artilleryDivision: true, strength: 84, printedRe: 3, stepsLost: 1 })
  assert.equal(combatStrengthFromFacts(arty), 2)
  assert.equal(combatStrengthFromFacts({ ...arty, attacking: true, terrain: 'Open' }), 42)
})

test('supply status and mode factors scale strength (OCS 9.5)', () => {
  assert.equal(combatStrengthFromFacts(strength({ outOfSupply: true })), 3)
  assert.equal(combatStrengthFromFacts(strength({ supplied: false })), 3)
  assert.equal(combatStrengthFromFacts(strength({ attacking: false, defenseFactor: 0 })), 0)
})

test('river and terrain multipliers follow the TEC (TTW TEC)', () => {
  assert.equal(combatStrengthFromFacts(strength({ terrain: 'major-river' })), 3)
  assert.equal(combatStrengthFromFacts(strength({ terrain: 'major-river', frozen: true, combatClass: 'mech' })), 3)
  assert.equal(combatStrengthFromFacts(strength({ terrain: 'minor-river', frozen: true, combatClass: 'armor' })), 3)
  assert.equal(combatStrengthFromFacts(strength({ attacking: false, terrain: 'Mountain', combatClass: 'armor' })), 2)
})

const crossing = (patch = {}) => ({ bridge: 'none', friendlyFerry: false, ice: false, ...patch })

test('Volga attack eligibility mirrors the movement ruling (TTW 1.4c)', () => {
  assert.equal(volgaAttackEligible(crossing({ bridge: 'intact' }), 'truck'), true)
  assert.equal(volgaAttackEligible(crossing({ bridge: 'repaired' }), 'track'), true)
  assert.equal(volgaAttackEligible(crossing({ bridge: 'blown' }), 'leg'), true)
  assert.equal(volgaAttackEligible(crossing({ bridge: 'blown' }), 'truck'), false)
  assert.equal(volgaAttackEligible(crossing({ friendlyFerry: true }), 'leg'), true)
  assert.equal(volgaAttackEligible(crossing({ ice: true }), 'leg'), true)
  assert.equal(volgaAttackEligible(crossing({ ice: true }), 'truck'), false)
  assert.equal(volgaAttackEligible(crossing(), 'leg'), false)
})

test('ferry attacks are at quarter strength (TTW 1.4c p.33)', () => {
  assert.equal(volgaFerryAttackFactor(crossing({ friendlyFerry: true })), 0.25)
  assert.equal(volgaFerryAttackFactor(crossing({ friendlyFerry: true, bridge: 'blown' })), 0.25)
  assert.equal(volgaFerryAttackFactor(crossing({ friendlyFerry: true, bridge: 'intact' })), 1)
  assert.equal(volgaFerryAttackFactor(crossing()), 1)
})

test('Volga retreat uses the exhaustive enumeration: bridges any, frozen Leg only (TTW 1.4c)', () => {
  assert.equal(volgaRetreatEligible({ bridge: 'intact', ice: false }, 'truck'), true)
  assert.equal(volgaRetreatEligible({ bridge: 'repaired', ice: false }, 'track'), true)
  assert.equal(volgaRetreatEligible({ bridge: 'blown', ice: false }, 'leg'), false)
  assert.equal(volgaRetreatEligible({ bridge: 'none', ice: true }, 'leg'), true)
  assert.equal(volgaRetreatEligible({ bridge: 'none', ice: true }, 'truck'), false)
  assert.equal(volgaRetreatEligible({ bridge: 'none', ice: false }, 'leg'), false)
  assert.equal(khersonAttackEligible('leg'), true)
  assert.equal(khersonAttackEligible('truck'), false)
  assert.equal(VOLGA_ADVANCE_RE_LIMIT, 3)
})

test('railway guns, Army and Army Group HQs are destroyed on forced retreat (TTW 1.6b/2.3b/2.3c)', () => {
  assert.equal(railwayGunCanBarrage(true), true)
  assert.equal(railwayGunCanBarrage(false), false)
  assert.equal(destroyedOnForcedRetreat({ railwayGun: true }), true)
  assert.equal(destroyedOnForcedRetreat({ armyHq: true }), true)
  assert.equal(destroyedOnForcedRetreat({ armyGroupHq: true }), true)
  assert.equal(destroyedOnForcedRetreat({}), false)
})

const assault = (patch = {}) => ({ attacking: true, assaultTerrain: false, river: false, crossingRiver: false, flameTank1890: false, ...patch })

test('assault units keep printed AR only against qualifying targets (TTW 1.6c)', () => {
  assert.equal(assaultUnitActionRating(5, assault({ assaultTerrain: true })), 5)
  assert.equal(assaultUnitActionRating(5, assault({ river: true })), 5)
  assert.equal(assaultUnitActionRating(5, assault()), 4)
  assert.equal(assaultUnitActionRating(5, assault({ attacking: false, assaultTerrain: true })), 4)
})

test('the 1890th never gains its bonus across a river (TTW 1.6c)', () => {
  assert.equal(assaultUnitActionRating(5, assault({ flameTank1890: true, crossingRiver: true, river: true })), 4)
  assert.equal(assaultUnitActionRating(5, assault({ flameTank1890: true, crossingRiver: true, assaultTerrain: true })), 4)
  assert.equal(assaultUnitActionRating(5, assault({ flameTank1890: true, assaultTerrain: true })), 5)
})

test('Army Group HQ destruction drags Axis combat and its DRM is once per turn (TTW 2.3c E/G)', () => {
  assert.equal(armyGroupDestroyedCombatDrm(true, true), -1)
  assert.equal(armyGroupDestroyedCombatDrm(false, true), 1)
  assert.equal(armyGroupDestroyedCombatDrm(true, false), 0)
  assert.equal(armyGroupDrmEligible({ usedThisGameTurn: false, axisUnitInThrowRange: true }), true)
  assert.equal(armyGroupDrmEligible({ usedThisGameTurn: true, axisUnitInThrowRange: true }), false)
  assert.equal(armyGroupDrmEligible({ usedThisGameTurn: false, axisUnitInThrowRange: false }), false)
  assert.equal(ARMY_HQ_DESTROYED_VP, 1)
  assert.equal(ARMY_GROUP_HQ_DESTROYED_VP, 2)
})

test('Corps HQ recovery rolls 1-3 to a free rebuild and 4-6 to the dead pile (TTW 2.3d)', () => {
  assert.equal(corpsHqRecoveryRoll(1), 'free-rebuild')
  assert.equal(corpsHqRecoveryRoll(3), 'free-rebuild')
  assert.equal(corpsHqRecoveryRoll(4), 'dead-pile')
  assert.equal(corpsHqRecoveryRoll(6), 'dead-pile')
  assert.throws(() => corpsHqRecoveryRoll(0), /Invalid Corps HQ recovery die/)
  assert.throws(() => corpsHqRecoveryRoll(7), /Invalid Corps HQ recovery die/)
  assert.throws(() => corpsHqRecoveryRoll(2.5), /Invalid Corps HQ recovery die/)
})

test('remnants generate only from a 16-4-3 last combat step with a pool battalion (TTW 2.4d)', () => {
  const facts = { parentIs1643Infantry: true, lastStepLostInCombat: true, poolHasRemnant: true }
  assert.equal(remnantGenerationEligible(facts), true)
  assert.equal(remnantGenerationEligible({ ...facts, parentIs1643Infantry: false }), false)
  assert.equal(remnantGenerationEligible({ ...facts, lastStepLostInCombat: false }), false)
  assert.equal(remnantGenerationEligible({ ...facts, poolHasRemnant: false }), false)
  assert.equal(remnantRebuildEligible({ axisReinforcement: true, corpsOrArmyHqStacked: true, paxAvailable: true }), true)
  assert.equal(remnantRebuildEligible({ axisReinforcement: true, corpsOrArmyHqStacked: false, paxAvailable: true }), false)
})

const column = (hex) => Number(hex.slice(1).split('.')[0])
const row = (hex) => Number(hex.split('.')[1])
const grid = (patch = {}) => ({
  neighbors: (hex) => ({
    'D10.10': ['D09.10', 'D11.10'],
    'D09.10': ['D08.10', 'D08.11', 'D10.10'],
    'D11.10': ['D12.10', 'D10.10'],
  }[hex] ?? []),
  distance: (a, b) => Math.max(Math.abs(column(a) - column(b)), Math.abs(row(a) - row(b))),
  column,
  open: () => true,
  friendlyRe: () => 0,
  ...patch,
})

test('remnant destinations lie exactly two hexes west along an open leg path (TTW 2.4d/Q06)', () => {
  assert.deepEqual(remnantDestinations('D10.10', grid()), ['D08.10', 'D08.11'])
  assert.deepEqual(remnantDestinations('D10.10', grid({ friendlyRe: (hex) => hex === 'D08.11' ? 10 : 0 })), ['D08.10'])
  assert.deepEqual(remnantDestinations('D10.10', grid({ open: (from) => from === 'D10.10' ? false : true })), [])
  assert.deepEqual(remnantDestinations('D10.10', grid({ open: (_from, to) => to !== 'D08.10' })), ['D08.11'])
})

test('defensive posture benefits need boundary and trace together (TTW 3.3d B)', () => {
  assert.equal(defensivePostureQualifies({ inFrontBoundary: true, traceFromAssignedArmyHq: true }), true)
  assert.equal(defensivePostureQualifies({ inFrontBoundary: true, traceFromAssignedArmyHq: false }), false)
  assert.equal(defensivePostureQualifies({ inFrontBoundary: false, traceFromAssignedArmyHq: true }), false)
  assert.equal(defensivePostureArModifier(false, true), 1)
  assert.equal(defensivePostureArModifier(true, true), -2)
  assert.equal(defensivePostureArModifier(false, false), 0)
  assert.equal(DEFENSIVE_BARRAGE_COLUMN_LABEL, '12-16')
  assert.equal(DEFENSIVE_FRONT_ATTACK_SUPPLY_CAP, 2)
})

test('barrage markers recover nine turns later and need an offensive front (TTW 3.4a-b)', () => {
  assert.equal(barrageMarkerRecoveryTurn(5), 14)
  assert.equal(BARRAGE_MARKER_RECOVERY_TURNS, 9)
  assert.equal(barrageMarkerUsable({ ready: true, frontPosture: 'offensive' }), true)
  assert.equal(barrageMarkerUsable({ ready: true, frontPosture: 'defensive' }), false)
  assert.equal(barrageMarkerUsable({ ready: false, frontPosture: 'offensive' }), false)
})

test('bridgehead enthusiasm caps RE per turn and quarters attack strength (TTW 4.3)', () => {
  assert.equal(BRIDGEHEAD_TURN_RE_LIMIT, 6)
  assert.equal(bridgeheadAttackStrength(8), 2)
  assert.equal(bridgeheadEligible({ enabled: true, infantryType: true, offensiveFrontTrace: true }), true)
  assert.equal(bridgeheadEligible({ enabled: false, infantryType: true, offensiveFrontTrace: true }), false)
  assert.equal(bridgeheadEligible({ enabled: true, infantryType: false, offensiveFrontTrace: true }), false)
})

test('mountain units gain AR only in mountain hexes when enabled (TTW 4.4)', () => {
  assert.equal(mountainUnitArModifier({ enabled: true, mountainUnit: true, mountainHex: true }), 1)
  assert.equal(mountainUnitArModifier({ enabled: true, mountainUnit: true, mountainHex: false }), 0)
  assert.equal(mountainUnitArModifier({ enabled: false, mountainUnit: true, mountainHex: true }), 0)
  assert.equal(mountainUnitArModifier({ enabled: true, mountainUnit: false, mountainHex: true }), 0)
})