import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scorpionGroundDeployment } from '../src/import/scorpion-deployment.ts'

const land = (name, side = 'soviet', re = 3) => ({ key: name, kind: 'land', source: { name, side, re,
  faces: { combat: { maColor: 'white', stats: { attack: 3, artRange: 2, move: 3 } },
    move: { maColor: 'white', stats: { attack: 2, artRange: 2, move: 4 } } } } })
const truck = (name, side = 'soviet') => ({ key: name, kind: 'transport', source: { name, side, re: 0,
  faces: { combat: { maColor: 'black', stats: { artRange: 0, move: 20 } }, move: null } } })
const formation = (name, side) => ({ key: `formation:${name}`, kind: 'formation',
  source: { name, side, faces: { combat: null, move: null } } })

// The three published Soviet loss pairs and the printed trucks the deployment always completes.
const pairs = [['Sov 232 Rifle Div', 'Sov 340 Rifle Div', [2, 11]], ['Sov 213 Rifle Div', 'Sov 252 Rifle Div', [18, 3]],
  ['Sov 66 Gd Rifle Div', 'Sov 69 Gd Rifle Div', [19, 7]]]
const trucks = ['Sov 5.Gd Tk Truck', 'Sov 5.Mech Truck', 'Sov 29.Tk Truck', 'Sov 18.Tk Truck', 'Sov Truck 2/45', 'Sov Truck']
const truckHexes = ['s2.16', 's4.15', 's20.03', 's20.04', 's13.05', 's5.16', 's21.04']
const pairRows = () => pairs.flatMap(([first, second, [col, row]]) =>
  [{ ref: first, at: { map: 'S', col, row } }, { ref: second, at: { map: 'S', col, row } }])

function fixture({ definitions = [], hexes: extraHexes = [] } = {}) {
  const all = [...pairs.flatMap(([first, second]) => [land(first), land(second)]),
    ...trucks.map((name) => truck(name)), truck('Ge 14.Pz Truck', 'axis'), ...definitions]
  const aliases = new Map()
  for (const definition of all) {
    aliases.set(definition.source.name, [...(aliases.get(definition.source.name) ?? []), definition])
  }
  const hexes = new Set([...pairs.map(([, , [col, row]]) => `s${col}.${String(row).padStart(2, '0')}`),
    ...truckHexes, ...extraHexes])
  return (rows) => scorpionGroundDeployment(rows, aliases, { hexes })
}

const marker = 'Sov 5.Gd Tk Corps'
const markerRow = (patch = {}) => ({ ref: marker, at: { map: 'S', col: 2, row: 16 }, side: 'soviet', ...patch })
const heading = (hex) => [{ definition: `formation:${marker}`, side: 'soviet', hex }]
const markerFixture = fixture({ definitions: [formation(marker, 'soviet')], hexes: ['s9.14'] })

test('a formation marker row is recorded as a heading and never becomes a counter', () => {
  const result = markerFixture([...pairRows(), markerRow()])
  assert.deepEqual(result.formationHeadings, heading('s2.16'))
  // Six infantry, five organic trucks and the three generic truck counters.
  assert.equal(Object.keys(result.units).length, 14)
  assert.ok(Object.values(result.units).every(({ definition }) => definition !== `formation:${marker}`))
  assert.equal(result.formationHeadings.length, 1)
  assert.equal(result.lossChoices.length, 3)
})

test('a marker takes the library side when the row omits it and leaves the stacked loss choice open', () => {
  // OCS 13.7A: the marker shares its hex with a unit of its formation; the pair beside it still chooses.
  const { formationHeadings, lossChoices, units } = markerFixture([
    ...pairRows(), { ref: marker, at: { map: 'S', col: 2, row: 11 } }])
  assert.deepEqual(formationHeadings, heading('s2.11'))
  const firstOfEachPair = pairRows().filter((_, index) => index % 2 === 0).map(({ ref }) => `setup:${ref}:1`)
  assert.deepEqual(lossChoices.map(({ candidates }) => candidates[0]), firstOfEachPair)
  assert.ok(lossChoices.every(({ stepsLost }) => stepsLost === 1))
  assert.equal(units['setup:Sov 232 Rifle Div:1'].stepsLost, 0)
})

test('a marker row carrying losses, a wrong side or an unknown hex is rejected', () => {
  for (const patch of [{ steps_lost: 1 }, { face: 'reduced' }, { side: 'axis' }, { at: { map: 'S', col: 9, row: 9 } }]) {
    assert.throws(() => markerFixture([...pairRows(), markerRow(patch)]),
      new RegExp(`Invalid Scorpion formation marker: ${marker}`))
  }
  const noSide = fixture({ definitions: [formation(marker, null)] })
  assert.throws(() => noSide([...pairRows(), markerRow()]), /Invalid Scorpion formation marker: Sov 5.Gd Tk Corps/)
  const ambiguous = fixture({ definitions: [formation(marker, 'soviet'), formation(marker, 'axis')] })
  assert.throws(() => ambiguous([...pairRows(), markerRow()]), /Invalid Scorpion ground deployment: Sov 5.Gd Tk Corps/)
})

test('a plain unit keeps its explicit losses when a marker row precedes it', () => {
  const deploy = fixture({ definitions: [formation(marker, 'soviet'), land('Ge 88 Inf Div', 'axis', 4)], hexes: ['s9.14'] })
  const rows = [...pairRows(), markerRow(), { ref: 'Ge 88 Inf Div', at: { map: 'S', col: 9, row: 14 }, steps_lost: 3 }]
  const { units, formationHeadings } = deploy(rows)
  assert.equal(units['setup:Ge 88 Inf Div:1'].stepsLost, 3)
  assert.deepEqual(formationHeadings, heading('s2.16'))
})
