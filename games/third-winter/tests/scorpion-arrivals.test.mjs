import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { scorpionArrivalCatalog } from '../src/import/scorpion-arrivals.ts'

const definition = (name, id) => ({
  key: `land:id:${id}`, kind: 'land', sourceFile: 'units.axis.json', sourceId: String(id), source: { name },
})
const aliasesOf = (...names) => new Map(names.map((name, index) => [name, [definition(name, index + 101)]]))
const block = (turn, side, entries) => [{ turn, phase: 'reinforce', side, entries }]

// The published organic-truck table is completed onto every catalog, so any block needs these names.
const truckNames = ['Sov 5.Gd Cav Truck', 'Ge 24.Pz Truck', 'Sov 20.Tk Truck', 'Sov 16.Tk Truck',
  'Ge 1.Pz Truck', 'Ge 1.SS Pz Truck', 'Ge 10.PG Truck']
const bySource = (arrivals, name) => arrivals.find(({ definition }) => definition === name)

test('published rows resolve through the catalog and carry face, note and truck data', () => {
  const names = [...truckNames, 'Ge 376 Inf Div', 'Sov 32.Cav Div']
  const arrivals = scorpionArrivalCatalog(block(2, 'soviet', [
    { ref: 'Sov 5.Gd Cav Truck', entry: 's22.09' },
    { ref: 'Sov 20.Tk Truck', entry: 's20.01' },
    { ref: 'Ge 376 Inf Div', entry: ['s4.02', 's4.03'], face: 'reduced' },
    { ref: 'Sov 32.Cav Div', entry: 's22.01', note: 'arrives with the truck' },
  ]), aliasesOf(...names))
  // Four published rows plus the five printed trucks this block does not list.
  assert.equal(arrivals.length, 9)
  assert.deepEqual(arrivals.slice(0, 4).map(({ id }) => id), [
    '2:soviet:land:id:101', '2:soviet:land:id:103', '2:soviet:land:id:108', '2:soviet:land:id:109',
  ])
  const optionalTruck = bySource(arrivals, 'land:id:101')
  assert.deepEqual(optionalTruck.destinations, ['s22.09'])
  assert.equal(optionalTruck.organicTruck, 'empty')
  assert.equal(optionalTruck.optionalForce, 'soviet-5-guards-cavalry')
  assert.equal(optionalTruck.stepsLost, undefined)
  const plainTruck = bySource(arrivals, 'land:id:103')
  assert.equal(plainTruck.organicTruck, 'empty')
  assert.equal(plainTruck.optionalForce, undefined)
  const twoStepLoss = bySource(arrivals, 'land:id:108')
  assert.deepEqual(twoStepLoss.destinations, ['s4.02', 's4.03'])
  assert.equal(twoStepLoss.face, 'reduced')
  assert.equal(twoStepLoss.stepsLost, 2, 'printed two-step losses outrank the reduced face')
  const plain = bySource(arrivals, 'land:id:109')
  assert.deepEqual(plain.destinations, ['s22.01'])
  assert.equal(plain.note, 'arrives with the truck')
  assert.equal(plain.face, undefined)
  assert.equal(plain.stepsLost, undefined)
  assert.equal(plain.organicTruck, undefined)
})

test('a reduced face alone costs one step and VP cost 5 makes a formation optional', () => {
  const names = [...truckNames, 'Ge 5.Pz Div', 'Ge 7.Inf Div', 'Ge 9.Inf Div']
  const arrivals = scorpionArrivalCatalog(block(6, 'axis', [
    { ref: 'Ge 5.Pz Div', entry: 's1.06', face: 'reduced' },
    { ref: 'Ge 7.Inf Div', entry: 's15.01', face: 'full' },
    { ref: 'Ge 9.Inf Div', entry: 's15.01', vp_cost: 5 },
  ]), aliasesOf(...names))
  assert.deepEqual(arrivals.slice(0, 3).map(({ stepsLost }) => stepsLost), [1, undefined, undefined])
  assert.equal(bySource(arrivals, 'land:id:108').optionalForce, undefined)
  assert.equal(bySource(arrivals, 'land:id:110').optionalForce, 'axis-24-panzer')
})

test('the old export is completed with the printed organic trucks it omits', () => {
  const arrivals = scorpionArrivalCatalog(block(1, 'soviet', []), aliasesOf(...truckNames))
  assert.equal(arrivals.length, 7)
  assert.equal(new Set(arrivals.map(({ id }) => id)).size, 7)
  for (const arrival of arrivals) assert.ok(['full', 'empty'].includes(arrival.organicTruck))
  const multiHex = bySource(arrivals, 'land:id:105')
  assert.deepEqual(multiHex.destinations, ['s1.03', 's1.06', 's7.01'])
  assert.equal(multiHex.optionalForce, undefined)
  assert.equal(bySource(arrivals, 'land:id:101').optionalForce, 'soviet-5-guards-cavalry')
  assert.equal(bySource(arrivals, 'land:id:102').optionalForce, 'axis-24-panzer')
})

test('a block that already lists a printed truck does not duplicate it', () => {
  const arrivals = scorpionArrivalCatalog(block(2, 'soviet', [
    { ref: 'Sov 5.Gd Cav Truck', entry: 's22.09' },
    { ref: 'Sov 20.Tk Truck', entry: 's20.01' },
  ]), aliasesOf(...truckNames))
  assert.equal(arrivals.length, 7)
  assert.equal(arrivals.filter(({ turn, side }) => turn === 2 && side === 'soviet').length, 2)
  const listed = bySource(arrivals, 'land:id:101')
  assert.equal(listed.organicTruck, 'empty')
  assert.equal(listed.optionalForce, 'soviet-5-guards-cavalry')
})

test('an unresolvable or ambiguous printed reference is rejected', () => {
  const names = [...truckNames, 'Sov 32.Cav Div']
  const rows = block(2, 'soviet', [{ ref: 'Sov 32.Cav Div', entry: 's22.01' }])
  // An empty alias table fails on the block row first; the printed trucks are only reached afterwards.
  assert.throws(() => scorpionArrivalCatalog(rows, new Map()), /does not resolve: Sov 32.Cav Div/)
  assert.throws(() => scorpionArrivalCatalog(block(2, 'soviet', []), new Map()),
    /does not resolve: Sov 5.Gd Cav Truck/)
  const ambiguous = aliasesOf(...names)
  ambiguous.set('Sov 32.Cav Div', [definition('Sov 32.Cav Div', 201), definition('Sov 32.Cav Div', 202)])
  assert.throws(() => scorpionArrivalCatalog(rows, ambiguous), /does not resolve/)
})

test('an entry location that is not a Scorpion hex is rejected', () => {
  const aliases = aliasesOf(...truckNames, 'Sov 32.Cav Div')
  assert.throws(() => scorpionArrivalCatalog(block(2, 'soviet', [
    { ref: 'Sov 32.Cav Div', entry: 'x1.05' },
  ]), aliases), /Invalid entry location for Sov 32.Cav Div/)
  assert.throws(() => scorpionArrivalCatalog(block(2, 'soviet', [
    { ref: 'Sov 32.Cav Div', entry: [] },
  ]), aliases), /Invalid entry location for Sov 32.Cav Div/)
})

test('a VP cost other than the published 5 is rejected', () => {
  assert.throws(() => scorpionArrivalCatalog(block(2, 'soviet', [
    { ref: 'Sov 32.Cav Div', entry: 's22.01', vp_cost: 4 },
  ]), aliasesOf(...truckNames, 'Sov 32.Cav Div')), /Invalid VP cost for Sov 32.Cav Div/)
})

test('the same unit twice in one turn is a duplicate arrival', () => {
  assert.throws(() => scorpionArrivalCatalog(block(2, 'soviet', [
    { ref: 'Sov 32.Cav Div', entry: 's22.01' },
    { ref: 'Sov 32.Cav Div', entry: 's22.02' },
  ]), aliasesOf(...truckNames, 'Sov 32.Cav Div')), /Duplicate Scorpion arrival: Sov 32.Cav Div/)
})

test('a block outside the reinforcement phase or turn window is rejected', () => {
  const aliases = aliasesOf(...truckNames)
  for (const [turn, phase] of [[2, 'movement'], [0, 'reinforce'], [9, 'reinforce'], [1.5, 'reinforce']]) {
    assert.throws(() => scorpionArrivalCatalog([{ turn, phase, side: 'soviet', entries: [] }], aliases),
      /Invalid Scorpion reinforcement block/)
  }
})
