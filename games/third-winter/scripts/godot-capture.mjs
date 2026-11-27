import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'
import { resolveScorpionEntry, settleScorpionCapture } from '../src/match/scorpion-capture.ts'

// Oracle fixture for the entry-capture slice (src/match/scorpion-capture.ts). A minimal in-play
// state is forged from the seed opening and `resolveScorpionEntry` settles the entry: ground control,
// the dump capture die, hedgehog reduction and air-base occupation. Transport windows are recorded
// with the manual policy so the native side replays the same pending window and resolves it with an
// explicit allocation; the reserve-only entry documents the captor assertion.
const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-capture.json'), tables = dist] = process.argv.slice(2)
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const seed = 19440126
const data = await loadLocalScorpion(resolve(root), resolve(tables))
const assets = data.assets

const started = sampleScorpionOpening(data.setup, data.assets, seed).started.state
const manual = { ...data.board, captureResolution: 'manual' }

function forgeBase() {
  const state = JSON.parse(JSON.stringify(started))
  state.cursor = { ...state.cursor, phase: 'combat', phasing: 'axis' }
  state.combat = null
  state.capture = null
  state.retreat = null
  state.captureHistory = []
  state.moved = []
  state.combatTargets = []
  state.combatAttackers = []
  return state
}

const base = forgeBase()
const findUnit = (predicate) => Object.entries(base.units).find(([, unit]) => predicate(unit))?.[0]
const axisCaptor = findUnit((unit) => unit.side === 'axis' && unit.attackCapable && !unit.reserve && unit.hex)
const sovietCaptor = findUnit((unit) => unit.side === 'soviet' && unit.attackCapable && !unit.reserve && unit.hex)
const sovietTruck = findUnit((unit) => unit.side === 'soviet' && !unit.combat && !unit.extender)
const axisBase = base.airBases.find((entry) => entry.side === 'axis')
if (!axisCaptor || !sovietCaptor || !sovietTruck || !axisBase) throw new Error('缺少构造夺取局面的算子')

const TRUCK_HEX = 's1.10'
const DUMP_HEX = 's1.11'
const HEDGE_HEX = 's1.12'
const AXIS_BASE_HEX = axisBase.hex
const DISPLACE_HEX = 's1.09'

const slice = (state, involved) => {
  const units = {}
  for (const [id, unit] of Object.entries(state.units)) {
    if (involved.includes(id) || id.startsWith('captured:')) units[id] = unit
  }
  return {
    units, dumps: state.dumps, airBases: state.airBases, hedgehogs: state.hedgehogs ?? {},
    pieces: state.pieces, railControl: state.railControl, capture: state.capture ?? null,
    captureHistory: state.captureHistory ?? [], rng: state.rng, moved: state.moved ?? [],
  }
}

const scenarios = []

function runScenario(name, note, hex, ids, side, policy, build, settle) {
  const state = JSON.parse(JSON.stringify(base))
  // Keep the entering units and the transport target; clear anything else standing on the target
  // hex so the capture object set is exactly what the scenario intends.
  state.units = Object.fromEntries(Object.entries(state.units)
    .filter(([id, unit]) => ids.includes(id) || id === sovietTruck || unit.hex !== hex))
  for (const id of ids) if (state.units[id]) state.units[id] = { ...state.units[id], hex }
  if (build) build(state)
  const involved = [...new Set([...ids, sovietTruck])]
  const before = JSON.parse(JSON.stringify(state))
  const steps = []
  const outcome = { rejection: null, captureSettled: false }
  let next = null
  try {
    next = resolveScorpionEntry(state, side, hex, ids, assets, false, policy)
    steps.push({ step: 'entry', actor: side, state: slice(next, involved) })
  } catch (error) {
    outcome.rejection = String(error.message ?? error)
  }
  if (next && settle) {
    const order = settle(next)
    const settled = settleScorpionCapture(next, next.capture.owner, order, assets)
    steps.push({ step: 'settle', actor: next.capture.owner, action: order, state: slice(settled, involved) })
    outcome.captureSettled = true
    next = settled
  }
  scenarios.push({ name, note, hex, ids: involved, entrants: ids, base: before, steps, outcome })
}

runScenario('dump', '轴心进格夺取苏军补给堆：按骰面夺取 25–75%，余数销毁', DUMP_HEX, [axisCaptor], 'axis', {},
  (state) => { state.dumps[`soviet:hex:${DUMP_HEX}`] = { side: 'soviet', location: 'on-map', tokens: 6 } },
  null)
runScenario('hedgehog-2', '苏军 2 级刺猬被夺取：立减一级、归夺取方，不打骰', HEDGE_HEX, [axisCaptor], 'axis', {},
  (state) => { state.hedgehogs = { ...state.hedgehogs, [HEDGE_HEX]: { side: 'soviet', level: 2 } } },
  null)
runScenario('hedgehog-1', '苏军 1 级刺猬被夺取：直接移除', HEDGE_HEX, [axisCaptor], 'axis', {},
  (state) => { state.hedgehogs = { ...state.hedgehogs, [HEDGE_HEX]: { side: 'soviet', level: 1 } } },
  null)
runScenario('airbase-flip', '苏军进格夺取轴心空军基地：手动窗口、基地翻面、停机飞机按航程位移',
  AXIS_BASE_HEX, [sovietCaptor], 'soviet', manual, null, (next) => ({
    type: 'settle-capture', extenders: [],
    aircraft: next.capture.aircraft.map(({ id, destinations }) => ({ id, destination: destinations[0] })),
    transports: [],
  }))
runScenario('reserve-only', '预备单位独自进格：格内敌方物资需要可进攻且非预备单位', DUMP_HEX, [axisCaptor],
  'axis', {}, (state) => {
    state.units[axisCaptor] = { ...state.units[axisCaptor], reserve: true }
    state.dumps[`soviet:hex:${DUMP_HEX}`] = { side: 'soviet', location: 'on-map', tokens: 6 }
  }, null)
runScenario('transports', '苏军卡车进格夺取：手动窗口 + 按夺取骰如数交给夺取方，余下的整队位移到射程内格',
  TRUCK_HEX, [axisCaptor], 'axis', manual, (state) => {
    state.units[sovietTruck] = { ...state.units[sovietTruck], hex: TRUCK_HEX, transportCargoTokens: 4 }
  }, (next) => {
    const group = next.capture.transports[0]
    const member = group.members[0]
    return { type: 'settle-capture', aircraft: [], extenders: [],
      transports: [{ id: member.id, takenPoints: group.points, takenTokens: group.tokens,
        ...(group.points < member.points || group.tokens < member.tokens ? { displacedTo: DISPLACE_HEX } : {}) }] }
  })

const fixture = { version: 1, scenarioId: '08-korsun-pocket', seed, fingerprint: data.fingerprint, scenarios }
await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(fixture) + '\n')
const stepCount = scenarios.reduce((sum, scenario) => sum + scenario.steps.length, 0)
console.log(`已导出 08 进格夺取对照 · 场景 ${scenarios.length} · 步骤 ${stepCount} · ${resolve(output)}`)
