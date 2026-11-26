import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadAuxCards, TTW_AUX_CARD_FILES } from '../src/import/aux-cards.ts'
import { campaignAuxCards } from '../src/view/campaign-aux-cards.ts'
import { openCampaignMatch } from '../src/match/campaign-match.ts'

const CALIB = 'D:/war game/OCS各作数据库/OCS第三个冬天/辅助卡标定/'
const readJson = (stem) => JSON.parse(readFileSync(`${CALIB}${stem}.boxes.json`, 'utf8'))
const counter = (side, location, extra = {}) => ({ kind: 'land', side, definition: `land:${side}`, location, stepsLost: 0, ...extra })

function setup() {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1, counters: {
    'ax-dead': counter('axis', { kind: 'dead-pile' }),
    'sv-dead': counter('soviet', { kind: 'dead-pile' }),
    'rv1-ready': counter('soviet', { kind: 'box', box: 'rvgk-1' }),
    'rv1-rebuild': counter('soviet', { kind: 'box', box: 'rvgk-1' }, { stepsLost: 1 }),
    'rv2-ready': counter('soviet', { kind: 'box', box: 'rvgk-2' }),
    'ax-pool': counter('axis', { kind: 'available' }),
    'sv-pool': counter('soviet', { kind: 'available' }),
  } }, 7)
  return { ...opened.state, weather: { ground: 'mud', flight: 'limited' },
    weatherHistory: { ...opened.state.weatherHistory, ice: true } }
}
const box = (views, card, label) => views.find((c) => c.name === card).boxes.find((b) => b.label === label)

test('loads all eight auxiliary cards from the calibration', () => {
  const cards = loadAuxCards(readJson)
  assert.equal(cards.length, 8)
  assert.deepEqual(cards.map((c) => c.name.trim()).sort(), [...TTW_AUX_CARD_FILES].map((s) => s.trim()).sort())
  assert.ok(cards.every((c) => c.boxes.length > 0 && c.src.endsWith('.jpg')))
})

test('dead piles and RVGK sections carry their side contents; weather track highlights the active box', () => {
  const views = campaignAuxCards(setup(), loadAuxCards(readJson))
  // Dead piles are side-scoped.
  assert.deepEqual(box(views, 'Axis Dead Pile ', 'B0').counterIds, ['ax-dead'])
  assert.deepEqual(box(views, 'Soviet Dead Pile', 'B0').counterIds, ['sv-dead'])
  // RVGK ready vs rebuilding partition by stepsLost.
  assert.deepEqual(box(views, 'Soviet RVGK', 'B0').counterIds, ['rv1-ready'])      // RVGK 1 Ready
  assert.deepEqual(box(views, 'Soviet RVGK', 'B1').counterIds, ['rv1-rebuild'])    // RVGK 1 Rebuilding
  assert.deepEqual(box(views, 'Soviet RVGK', 'B2').counterIds, ['rv2-ready'])      // RVGK 2 Ready
  assert.deepEqual(box(views, 'Soviet RVGK', 'B3').counterIds, [])                 // RVGK 2 Rebuilding empty
  // Turn record: mud ground, limited flight, frozen Dnepr.
  const turn = views.find((c) => c.name === 'Turn Record b')
  assert.equal(turn.boxes.find((b) => b.id === '泥泞').active, true)
  assert.equal(turn.boxes.find((b) => b.id === '干燥').active, false)
  assert.equal(turn.boxes.find((b) => b.kind === 'Flight Condition' && b.id === '有限').active, true)
  assert.equal(turn.boxes.find((b) => b.kind === 'Dnepr River Condition' && b.id === '冰封').active, true)
  // Pool boxes carry the side's available counters.
  assert.deepEqual(box(views, 'Axis Breakdowns', 'B0').counterIds, ['ax-pool'])
  assert.deepEqual(box(views, 'Soviet Off Map', 'B0').counterIds, ['sv-pool'])
})