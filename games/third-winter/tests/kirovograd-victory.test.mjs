import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unitCatalog } from '../src/import/unit-catalog.ts'
import { kirovogradFormationClassOf, kirovogradFormationGaps, kirovogradLossClass, kirovogradLosses } from '../src/match/kirovograd-victory.ts'
import { kirovogradOutcome, kirovogradVictoryPoints } from '../src/ttw/campaign/kirovograd.ts'

const none = { axisArmorFormationUnits: 0, sovietArmorUnits: 0, axisHq: { total: 0, army: 0, armyGroup: 0 } }
const score = (extra) => kirovogradVictoryPoints({ ...none, kirovogradLiberated: false, kirovogradSovietAtEnd: false, ...extra })

test('the bands split at zero, two and five net VP', () => {
  assert.deepEqual(score({}), { soviet: 0, axis: 0, net: 0 })
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(kirovogradOutcome), [
    { outcome: 'axis', level: 'major' }, { outcome: 'axis', level: 'minor' }, { outcome: 'axis', level: 'minor' },
    { outcome: 'soviet', level: 'minor' }, { outcome: 'soviet', level: 'minor' },
    { outcome: 'soviet', level: 'major' }, { outcome: 'soviet', level: 'major' }])
  assert.deepEqual(kirovogradOutcome(-3), { outcome: 'axis', level: 'major' })
  assert.throws(() => kirovogradOutcome(1.5), /Invalid Kirovograd net VP/)
})

test('Kirovograd, destroyed units and destroyed HQs score as printed, with TTW 2.3b-c added for Army and Army Group HQs', () => {
  assert.equal(score({ kirovogradLiberated: true }).soviet, 1)
  assert.equal(score({ kirovogradSovietAtEnd: true }).soviet, 1)
  assert.equal(score({ axisArmorFormationUnits: 7 }).net, 7)
  assert.equal(score({ axisArmorFormationUnits: 7, sovietArmorUnits: 5 }).axis, 2)
  assert.deepEqual(score({ sovietArmorUnits: 4 }), { soviet: 0, axis: 2, net: -2 })
  // one VP per two HQs of any level, and Army HQs once more under 2.3b
  assert.deepEqual(score({ axisHq: { total: 3, army: 0, armyGroup: 0 } }), { soviet: 1, axis: 0, net: 1 })
  assert.deepEqual(score({ axisHq: { total: 3, army: 1, armyGroup: 0 } }), { soviet: 2, axis: 0, net: 2 })
  // an Army Group HQ is worth two further VP under 2.3c, and is one of the destroyed HQs
  assert.deepEqual(score({ axisHq: { total: 2, army: 0, armyGroup: 1 } }), { soviet: 3, axis: 0, net: 3 })
  // an Army HQ destroyed twice after its free rebuild scores twice
  assert.deepEqual(score({ axisHq: { total: 4, army: 4, armyGroup: 0 } }), { soviet: 6, axis: 0, net: 6 })
  assert.throws(() => score({ axisArmorFormationUnits: -1 }), /Invalid Kirovograd loss count/)
  assert.throws(() => score({ axisHq: { total: 1.5, army: 0, armyGroup: 0 } }), /Invalid Kirovograd loss count/)
})

const catalog = unitCatalog([{ kind: 'land', file: 'units', rows: [
  { id: 'pzb', name: 'Ge 3.Pz II-6 Pz Bn', side: 'axis', nation: 'Ge', category: 'armor', org: { parentFmt: '3.Pz', airGroup: null } },
  { id: 'arty', name: 'Ge 3.Pz 75 Arty Rgt', side: 'axis', nation: 'Ge', category: 'arty', org: { parentFmt: '3.Pz', airGroup: null } },
  { id: 'pg', name: 'Ge 10.PG 10 PJ Bn', side: 'axis', nation: 'Ge', category: 'mech', org: { parentFmt: '10.PG', airGroup: null } },
  { id: 'kg', name: 'Ge 320 Inf KG', side: 'axis', nation: 'Ge', category: 'infantry' },
  { id: 'inf', name: 'Ge 371 Inf Rgt', side: 'axis', nation: 'Ge', category: 'infantry', org: { parentFmt: '320.Inf', airGroup: null } },
  { id: 'tk', name: 'Sov 29.Tk 25 Tk Bde', side: 'soviet', nation: 'Sov', category: 'armor', org: { parentFmt: '29.Tk', airGroup: null } },
  { id: 'mot', name: 'Sov 29.Tk 53 Mot Inf Bde', side: 'soviet', nation: 'Sov', category: 'mech', org: { parentFmt: '29.Tk', airGroup: null } },
  { id: 'mort', name: 'Sov 29.Tk 271 Mort Rgt', side: 'soviet', nation: 'Sov', category: 'arty', org: { parentFmt: '29.Tk', airGroup: null } },
  { id: 'rifle', name: 'Sov 78 Rifle Div', side: 'soviet', nation: 'Sov', category: 'infantry' },
] }, { kind: 'hq', file: 'hq', rows: [
  { id: 'a', name: 'Ge HQ 8 Army', side: 'axis', nation: 'Ge', category: 'hq' },
  { id: 'c', name: 'Ge HQ 47 Pz Corps', side: 'axis', nation: 'Ge', category: 'hq' },
  { id: 's', name: 'Sov HQ 2nd Ukr Front', side: 'soviet', nation: 'Sov', category: 'hq' },
] }, { kind: 'formation', file: 'formation', rows: [
  { id: 'f1', name: 'Ge 3.Pz Div', side: 'axis', nation: 'Ge', category: 'armor', org: { parentFmt: '3.Pz', airGroup: null } },
  { id: 'f2', name: 'Ge 10.PG Div', side: 'axis', nation: 'Ge', category: 'mech', org: { parentFmt: '10.PG', airGroup: null } },
  { id: 'f3', name: 'Ge 320.Inf Div', side: 'axis', nation: 'Ge', category: 'infantry', org: { parentFmt: '320.Inf', airGroup: null } },
  { id: 'f4', name: 'Sov 29.Tk Corps', side: 'soviet', nation: 'Sov', category: 'armor', org: { parentFmt: '29.Tk', airGroup: null } },
] }])
const definition = (kind, id) => catalog.definitions.get(`${kind}:id:${id}`)
const formationClassOf = kirovogradFormationClassOf(catalog.definitions)
const lossClass = (kind, id) => kirovogradLossClass(definition(kind, id), formationClassOf)

test('an Axis unit scores by the class of its parent formation, a Soviet unit by its own printed class', () => {
  // the artillery of a Panzer division is not an armor unit, but it belongs to an armored formation
  assert.equal(lossClass('land', 'pzb'), 'axis-armor-formation')
  assert.equal(lossClass('land', 'arty'), 'axis-armor-formation')
  assert.equal(lossClass('land', 'pg'), 'axis-armor-formation')
  assert.equal(lossClass('land', 'kg'), undefined)
  assert.equal(lossClass('land', 'inf'), undefined)
  assert.equal(lossClass('hq', 'a'), 'axis-army-hq')
  assert.equal(lossClass('hq', 'c'), 'axis-other-hq')
  assert.equal(lossClass('hq', 's'), undefined)
  assert.equal(lossClass('land', 'tk'), 'soviet-armor-formation')
  assert.equal(lossClass('land', 'mot'), 'soviet-armor-formation')
  assert.equal(lossClass('land', 'mort'), undefined)
  assert.equal(lossClass('land', 'rifle'), undefined)
  assert.equal(kirovogradLossClass(undefined, formationClassOf), undefined)
})

test('destruction events are tallied into the loss counts and conflicting formation classes are a data error', () => {
  const destroyed = ['land:pzb', 'land:arty', 'hq:a', 'hq:c', 'land:tk', 'land:rifle', 'hq:s'].map((ref) => {
    const [kind, id] = ref.split(':')
    return lossClass(kind, id)
  })
  assert.deepEqual(kirovogradLosses(destroyed), { axisArmorFormationUnits: 2, sovietArmorUnits: 1, axisHq: { total: 2, army: 1, armyGroup: 0 } })
  assert.deepEqual(kirovogradLosses(destroyed, 1), { axisArmorFormationUnits: 2, sovietArmorUnits: 1, axisHq: { total: 3, army: 1, armyGroup: 1 } })
  assert.throws(() => kirovogradLosses(destroyed, -1), /Invalid destroyed Army Group HQ count/)
  const conflicting = unitCatalog([{ kind: 'formation', file: 'formation', rows: [
    { id: 'f1', name: 'Ge 3.Pz Div', side: 'axis', nation: 'Ge', category: 'armor', org: { parentFmt: '3.Pz', airGroup: null } },
    { id: 'f9', name: 'Ge 3.Pz Div alt', side: 'axis', nation: 'Ge', category: 'infantry', org: { parentFmt: '3.Pz', airGroup: null } },
  ] }])
  assert.throws(() => kirovogradFormationClassOf(conflicting.definitions), /Conflicting formation classes/)
})

test('members whose formation record is missing or carries no code are reported as a gap', () => {
  assert.deepEqual(kirovogradFormationGaps(catalog.definitions), [])
  const rowsOf = (kind) => [...catalog.definitions.values()].filter((item) => item.kind === kind).map(({ source }) => source)
  const broken = unitCatalog([
    ...['land', 'hq', 'formation'].map((kind) => ({ kind, file: kind, rows: rowsOf(kind) })),
    { kind: 'land', file: 'units', rows: [{ id: 'gd', name: 'Ge GD II Pz Bn', side: 'axis', nation: 'Ge', category: 'armor',
      org: { parentFmt: 'GD', airGroup: null } }] },
    // the formation record exists but carries no code, as in the library for GD, Lehr and 18.Art
    { kind: 'formation', file: 'formation', rows: [{ id: 'gdf', name: 'Ge GD.PG Div', side: 'axis', nation: 'Ge', category: 'mech' }] },
  ])
  assert.deepEqual(kirovogradFormationGaps(broken.definitions), [{ code: 'Ge:GD', units: ['Ge GD II Pz Bn'] }])
  assert.deepEqual(kirovogradFormationGaps(broken.definitions, new Set(['land:id:pzb'])), [])
})
