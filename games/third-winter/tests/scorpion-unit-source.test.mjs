import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { scorpionGroundProfile } from '../src/import/ground-profile.ts'
import { loadScorpionUnits } from '../src/import/scorpion-unit-sources.ts'
import { loadThirdWinterUnits } from '../src/import/unit-backup.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'

const face = (asset, move, maColor) => ({ asset, maColor, stats: { move } })
const wall = { id: '4154', name: 'Ge Wall SS Mot Inf Rgt', kind: 'ground', side: 'axis',
  faces: { combat: face('wall.png', 3, 'white'), move: face('wall-move.png', 16, 'black') } }
const scout = { id: '1675', name: 'Ge 10.PG 110 Aufk Bn', kind: 'ground', side: 'axis',
  faces: { combat: face('TTW1 S4 R04 C12.png', 8, 'unknown'), move: face('TTW1 S4 R04 C12B.png', 18, null) } }
const soviet = { ...wall, id: '4154', name: 'Sov test', side: 'soviet' }
const aircraft = { id: '4300', name: 'Sov test Yak.9', kind: 'air', category: 'hq', side: 'soviet',
  faces: { combat: face('yak.png', null, null), move: null } }
const marker = { id: '4154', name: 'Test marker', side: null,
  faces: { combat: face('marker.png', null, null), move: null } }

test('the cleaned unit backup preserves source roles, scoped IDs and the Scorpion setup references', async () => {
  const distinctSoviet = { ...soviet, id: '100' }
  const breakdowns = [['axis', '4008', 'Ge 4-4-3'], ['axis', '4007', 'Ge 3-3-3'], ['soviet', '2574', 'Sov Gd 3-4-3'],
    ['soviet', '2575', 'Sov Gd 3-3-3'], ['soviet', '1723', 'Sov 3-3-3'], ['soviet', '1724', 'Sov 3-2-2']]
    .map(([side, id, printed]) => ({ ...wall, id, side, name: `${printed} Brkdwn` }))
  const tables = {
    'units.axis.json': [wall, scout, ...breakdowns.filter(({ side }) => side === 'axis')],
    'units.soviet.json': [distinctSoviet, ...breakdowns.filter(({ side }) => side === 'soviet')],
    'units.air.json': [aircraft], 'units.marker.json': [marker],
  }
  const read = async (file) => ({ version: 1, units: tables[file] })
  const catalog = await loadScorpionUnits(read)
  assert.equal(catalog.definitions.size, 11)
  for (const { id, name } of breakdowns) {
    assert.equal(catalog.aliases.get(name.replace('Brkdwn', '拆分单位'))[0].key, `land:id:${id}`)
  }
  assert.deepEqual(catalog.rawIds.get('4154').map(({ key }) => key), ['land:id:4154', 'marker:id:4154'])
  assert.equal(catalog.aliases.get('Ge Wallonian SS Mot Inf Rgt')[0].source, wall)
  assert.equal(catalog.definitions.get('aircraft:id:4300').source, aircraft)
  const definition = catalog.definitions.get('land:id:1675')
  assert.deepEqual(scorpionGroundProfile(definition, 'combat'), { side: 'axis', combat: true, allowance: 8, mobility: 'track' })
  assert.deepEqual(scorpionGroundProfile(definition, 'move'), { side: 'axis', combat: true, allowance: 18, mobility: 'track' })
  assert.equal(scorpionGroundProfile(catalog.definitions.get('land:id:4154'), 'move').mobility, 'truck')

  tables['units.soviet.json'] = [soviet]
  await assert.rejects(loadThirdWinterUnits(read), /Conflicting definition key/)
  tables['units.soviet.json'] = [wall]
  await assert.rejects(loadThirdWinterUnits(read), /Wrong unit kind or side/)
})

test('the v2 catalog keeps the printed nation of each unit for nationality-specific rules', async () => {
  const table = (units) => async () => ({ meta: { schema: 'ocs-wargame-db-v2', game: 'Third Winter', count: units.length },
    units, markers: units })
  // The v2 library prints its numbers as strings.
  const tables = {
    'units_inf_div.json': table([{ id: '1', name: 'Hun 2.Pz I-3 Pz Bn', faction: 'AXIS', RE: '1', nation: 'Hun' },
      { id: '2', name: 'Ge 8 Jg Bde', faction: 'AXIS', RE: '3', nation: 'Ge' }]),
    'units_hq.json': table([{ id: '3', name: 'Ge HQ 58 Pz Corps', faction: 'AXIS', RE: '1', nation: 'Ge', kessel: true, hq_kind: 'kessel' },
      { id: '8', name: 'Ge HQ AGS', faction: 'AXIS', RE: '1', nation: 'Ge', hq_kind: 'ags', rail_only: true, rail_cap_RE: 1, must_be_city: true }]),
    'units_transport.json': table([{ id: '4', name: 'Axis Truck', faction: 'AXIS', RE: null, nation: 'Axis' }]),
    'units_air.json': table([{ id: '5', name: 'Ge He.177', faction: 'AXIS', RE: '1', nation: 'Ge' }]),
    'units_air_army_hq.json': table([{ id: '6', name: 'Sov 2 Air Army HQ', faction: 'SOV', RE: '1', nation: 'Sov' }]),
    'units_luftflotte_hq.json': table([{ id: '7', name: 'Ge Luftflotte 4', faction: 'AXIS', RE: '1', nation: 'Ge' }]),
    'units_formation.json': table([{ id: '8', name: 'Hun 2.Pz Div', faction: 'AXIS', RE: null, nation: 'Hun' }]),
    'units_markers.json': table([{ id: '9', name: 'Test marker', faction: null, side: 'Axis', RE: null, nation: 'Ge' }]),
  }
  const read = (file) => tables[file]()
  const catalog = await loadThirdWinterV2Units(read)
  assert.equal(catalog.aliases.get('Hun 2.Pz I-3 Pz Bn')[0].source.nation, 'Hun')
  assert.equal(catalog.aliases.get('Ge 8 Jg Bde')[0].source.nation, 'Ge')
  assert.equal(catalog.aliases.get('Hun 2.Pz Div')[0].kind, 'formation')
  assert.equal(catalog.aliases.get('Axis Truck')[0].source.nation, 'Axis')
  // the explicit HQ class is carried into the runtime unit for the campaign HQ hooks
  assert.equal(catalog.aliases.get('Ge HQ 58 Pz Corps')[0].source.hqKind, 'kessel')
  // the data-driven rail movement flags are carried for the HQ rail-only gate / rail facts
  const ags = catalog.aliases.get('Ge HQ AGS')[0].source
  assert.equal(ags.railOnly, true)
  assert.equal(ags.railCapRe, 1)
  assert.equal(ags.mustBeCity, true)
  assert.equal(catalog.aliases.get('Ge HQ 58 Pz Corps')[0].source.railOnly, undefined)
  // A nation that is present but blank is a data error rather than a missing one.
  tables['units_hq.json'] = table([{ id: '3', name: 'Ge HQ 58 Pz Corps', faction: 'AXIS', RE: '1', nation: ' ' }])
  await assert.rejects(loadThirdWinterV2Units(read), /无效的算子国籍/)
})

test('HQ ground mobility is data-driven from the printed MA color: Kessel leg, Corps wheeled, rail-only HQ none', async () => {
  const table = (units) => async () => ({ meta: { schema: 'ocs-wargame-db-v2', game: 'Third Winter', count: units.length }, units, markers: units })
  const f = (file, ma, maColor) => ({ file, A: '1', MA: ma, ma_color: maColor })
  // Values mirror data/units_hq.json: Kessel back MA3 white, Corps back MA10 black, Army Group back MA rr rail.
  const tables = {
    'units_inf_div.json': table([{ id: '1', name: 'Ge 8 Jg Bde', faction: 'AXIS', RE: '3', nation: 'Ge' }]),
    'units_hq.json': table([
      { id: '3', name: 'Ge HQ 1 Pz Kessel', faction: 'AXIS', RE: '1', nation: 'Ge', hq_kind: 'kessel', kessel: true, front: f('k.png', '0', 'white'), back: f('kb.png', '3', 'white') },
      { id: '10', name: 'Ge HQ 4 Corps', faction: 'AXIS', RE: '1', nation: 'Ge', hq_kind: 'corps', front: f('c.png', '0', 'black'), back: f('cb.png', '10', 'black') },
      { id: '8', name: 'Ge HQ AGS', faction: 'AXIS', RE: '1', nation: 'Ge', hq_kind: 'ags', rail_only: true, rail_cap_RE: 1, must_be_city: true, front: f('a.png', '0', 'rail'), back: f('ab.png', 'rr', 'rail') },
    ]),
    'units_transport.json': table([{ id: '4', name: 'Axis Truck', faction: 'AXIS', RE: null, nation: 'Axis' }]),
    'units_air.json': table([{ id: '5', name: 'Ge He.177', faction: 'AXIS', RE: '1', nation: 'Ge' }]),
    'units_air_army_hq.json': table([{ id: '6', name: 'Sov 2 Air Army HQ', faction: 'SOV', RE: '1', nation: 'Sov' }]),
    'units_luftflotte_hq.json': table([{ id: '7', name: 'Ge Luftflotte 4', faction: 'AXIS', RE: '1', nation: 'Ge' }]),
    'units_formation.json': table([{ id: '11', name: 'Hun 2.Pz Div', faction: 'AXIS', RE: null, nation: 'Hun' }]),
    'units_markers.json': table([{ id: '9', name: 'Test marker', faction: null, side: 'Axis', RE: null, nation: 'Ge' }]),
  }
  const catalog = await loadThirdWinterV2Units((file) => tables[file]())
  const profile = (name) => scorpionGroundProfile(catalog.aliases.get(name)[0], 'move')
  // 突围（Kessel）HQ 徒步移动力（white MA3）。
  assert.deepEqual(profile('Ge HQ 1 Pz Kessel'), { side: 'axis', combat: true, allowance: 3, mobility: 'leg' })
  // 军（Corps）HQ 轮式移动力（black MA10）。
  assert.deepEqual(profile('Ge HQ 4 Corps'), { side: 'axis', combat: true, allowance: 10, mobility: 'truck' })
  // 仅铁路 HQ（rr）无地面移动 profile，配合 railOnly 闸门只走铁路。
  assert.equal(profile('Ge HQ AGS'), null)
})
