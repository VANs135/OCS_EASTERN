import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { scorpionGroundProfile } from '../src/import/ground-profile.ts'
import { loadScorpionUnits } from '../src/import/scorpion-unit-sources.ts'
import { loadThirdWinterUnits } from '../src/import/unit-backup.ts'

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
