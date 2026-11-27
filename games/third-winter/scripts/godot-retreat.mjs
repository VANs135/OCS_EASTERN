import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'
import { resolveScorpionCombat, continueScorpionRetreatResult } from '../src/match/scorpion-combat-result.ts'
import {
  retreatScorpionCombat, scorpionRetreatPathOptions, canScorpionRetreat,
} from '../src/match/scorpion-retreat.ts'

// Oracle fixture for the defender-retreat rule slice. A minimal combat record is forged on the
// seed opening (declare/defend/rating/terrain supply chain is bypassed, as in the retreat example),
// then the TS engine settles the defender retreat. Variants cover: normal retreat, minor-river
// hexside crossing, enemy-ZOC forced step loss, elimination to the dead pile, hedgehog level on the
// defender hex, and a capture suspension whose continue command is refused.
const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-retreat.json'), tables = dist] = process.argv.slice(2)
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const seed = 19440126
const data = await loadLocalScorpion(resolve(root), resolve(tables))
const map = data.assets.map
const table = data.board.combat.table

const started = sampleScorpionOpening(data.setup, data.assets, seed).started.state

function forgeBaseState() {
  const state = JSON.parse(JSON.stringify(started))
  state.cursor = { ...state.cursor, phase: 'combat', phasing: 'soviet' }
  state.combatTargets = []
  state.combatAttackers = []
  state.moved = []
  state.combat = null
  state.capture = null
  state.retreat = null
  return state
}

const sliceUnits = (state, ids) => Object.fromEntries(ids.filter((id) => state.units[id] !== undefined)
  .map((id) => [id, state.units[id]]))
const sliceDumps = (state, ids) => Object.fromEntries(ids.filter((id) => state.dumps[id] !== undefined)
  .map((id) => [id, state.dumps[id]]))
const slicePieces = (state, ids) => state.pieces.filter((piece) => ids.includes(piece.id))

const edgeRiver = (from, to) => map.edge(from, to)?.river ?? null

// attackerHex / origin / destination per variant. PAIR_A geometry: soviet 2073 at s1.11 facing
// axis 3951 at s1.10. PAIR_R geometry: axis 4036 at s1.09, soviet attacker relayed to s1.10.
const PAIR_A = { attackerId: 'setup:land:id:2073:1', defenderId: 'setup:land:id:3951:1',
  attackerHex: 's1.11', origin: 's1.10' }
const PAIR_R = { attackerId: 'setup:land:id:2073:1', defenderId: 'setup:land:id:4036:1',
  attackerHex: 's1.10', origin: 's1.09' }

const SCENARIOS = [
  {
    ...PAIR_A, name: 'normal', note: '守方满一步撤退到相邻开阔格；无 ZOC、无河流、无刺猬',
    destination: 's2.10',
    mutate: () => undefined,
  },
  {
    ...PAIR_A, name: 'hedgehog', note: '目标格刺猬等级 1：守方反坦克 ≥2，掷骰行再减 1；随后撤退',
    destination: 's2.10',
    mutate: (state, ctx) => {
      state.hedgehogs = { ...state.hedgehogs, [ctx.origin]: { side: 'axis', level: 1 } }
    },
  },
  {
    ...PAIR_A, name: 'zoc-loss', note: '撤退进入攻方原始 ZOC：本格 DG，DG 战斗单位被迫损一步（计划指定）',
    destination: 's2.10',
    zocLoss: true,
    mutate: (state, ctx) => {
      state.units = { ...state.units, [ctx.defenderId]:
        { ...state.units[ctx.defenderId], disorganized: true } }
    },
  },
  {
    ...PAIR_A, name: 'elimination', note: 'ZOC 被迫损一步消灭守方（剩余 1 步），算子落入死人堆',
    destination: 's2.10',
    zocLoss: true,
    mutate: (state, ctx) => {
      state.units = { ...state.units, [ctx.defenderId]:
        { ...state.units[ctx.defenderId], disorganized: true, printedRe: 1, stepsLost: 0, strength: 1 } }
    },
  },
  {
    ...PAIR_R, name: 'river', note: '撤退跨越小河格边（minor river），腿式可通过；不产生额外步损',
    destination: 's1.08',
    mutate: () => undefined,
  },
  {
    ...PAIR_R, name: 'suspended', note: '撤退进入含苏非战斗运输队的格：夺取挂起；continue-combat-retreat 被拒绝（先结算夺取）',
    destination: 's2.09',
    suspended: true,
    mutate: () => undefined,
  },
]

const baseState = forgeBaseState()
const truckId = Object.keys(baseState.units).find((id) =>
  baseState.units[id].side === 'soviet' && baseState.units[id].combat !== true)
const scenarios = []

for (const scenario of SCENARIOS) {
  const state = JSON.parse(JSON.stringify(baseState))
  const ctx = { attackerId: scenario.attackerId, defenderId: scenario.defenderId,
    attackerHex: scenario.attackerHex, origin: scenario.origin, target: scenario.origin }

  // 清空交战格与中继格的其他算子，只保留攻/守双方与（挂起场景用）苏军运输队（夹具专用）。
  state.units = Object.fromEntries(Object.entries(state.units).filter(([id, unit]) =>
    id === ctx.attackerId || id === ctx.defenderId || id === truckId ||
    (unit.hex !== ctx.attackerHex && unit.hex !== ctx.origin)))
  state.units[ctx.attackerId] = { ...state.units[ctx.attackerId], hex: ctx.attackerHex }
  state.units[ctx.defenderId] = { ...state.units[ctx.defenderId], hex: ctx.origin }
  scenario.mutate(state, ctx)
  const baseSnapshot = JSON.parse(JSON.stringify(state))

  const unitIds = [ctx.attackerId, ctx.defenderId]
  const dumpIds = Object.keys(state.dumps)
  const steps = []

  const combat = {
    target: ctx.origin, attacker: 'soviet', attackers: [ctx.attackerId], defenders: [ctx.defenderId],
    attackerLeader: ctx.attackerId, defenderLeader: ctx.defenderId,
    heldAtStart: { soviet: [ctx.attackerHex], axis: [ctx.origin] },
    hedgehog: state.hedgehogs?.[ctx.origin]?.level ?? 0, kind: 'combat',
    roll: { code: 'D1', attacker: { loss: 0, option: 0 }, defender: { loss: 0, option: 1 },
      exploit: null, disorganize: false },
    step: 'defender-result',
  }
  state.combat = combat

  const options = scorpionRetreatPathOptions(state, 'axis',
    { origin: ctx.origin, units: [ctx.defenderId], path: [] }, combat, data.assets)
  const destination = scenario.destination ?? options[0]
  if (!options.includes(destination)) {
    throw new Error(`场景 ${scenario.name} 撤退格 ${destination} 不在可选格内：${options.join(',')}`)
  }
  const plan = { group: 'group:0', units: [ctx.defenderId], path: [destination] }
  if (scenario.zocLoss) plan.zocLosses = { 0: ctx.defenderId }
  const canRetreat = canScorpionRetreat(state.units[ctx.defenderId], 'axis', ctx.origin, data.assets.catalog)

  steps.push({ step: 'forge', actor: 'axis', action: { target: ctx.origin, attackers: [ctx.attackerId] },
    combat, roll: combat.roll, units: sliceUnits(state, unitIds), dumps: sliceDumps(state, dumpIds),
    pieces: slicePieces(state, unitIds), pathOptions: options, canRetreat })

  let next = state
  let rejection = null
  if (scenario.suspended) {
    // 把一名真实苏军运输队 relayed 到撤退格；夺取需要运输队 displaced 选择才会挂起待决。
    if (!truckId) throw new Error('挂起场景缺少苏军运输队')
    next.units = { ...next.units, [truckId]: { ...next.units[truckId], hex: destination } }
    const manualPolicy = { ...data.board, captureResolution: 'manual' }
    const settled = retreatScorpionCombat(next, 'axis', next.combat.defenders, 1, [plan], next.combat,
      data.assets, manualPolicy)
    next = settled.state
    // 与 combat-result 一致：挂起待决要写回 combat.retreat，continue 入口据此识别待决方。
    next.combat = { ...next.combat, retreat: settled.pending }
    const defenderAction = { lossOrder: [], optionLosses: 0, ignoreDefenderOption: false,
      retreats: [plan], remnants: [] }
    steps.push({ step: 'retreat-suspend', actor: 'axis', action: defenderAction,
      combat: next.combat, pending: settled.pending, capture: next.capture,
      units: sliceUnits(next, [...unitIds, truckId]), dumps: sliceDumps(next, dumpIds),
      pieces: slicePieces(next, unitIds) })
    try {
      continueScorpionRetreatResult(next, 'axis', { routes: [] }, data.assets, manualPolicy)
    } catch (error) {
      rejection = { message: String(error.message ?? error) }
    }
  } else {
    const defenderAction = { lossOrder: [], optionLosses: 0, ignoreDefenderOption: false,
      retreats: [plan], remnants: [] }
    next = resolveScorpionCombat(next, 'axis', defenderAction, data.assets, data.board)
    steps.push({ step: 'defender-result', actor: 'axis', action: defenderAction,
      combat: next.combat, result: next.combat?.roll?.defender ?? null,
      units: sliceUnits(next, unitIds), dumps: sliceDumps(next, dumpIds),
      pieces: slicePieces(next, unitIds) })
  }

  scenarios.push({
    name: scenario.name, note: scenario.note, target: ctx.origin,
    attackerId: ctx.attackerId, defenderId: ctx.defenderId,
    origin: ctx.origin, destination, pathOptions: options, canRetreat, base: baseSnapshot, steps,
    outcome: {
      retreatPending: next.combat?.retreat !== undefined && next.combat?.retreat !== null,
      capturePending: next.capture !== undefined && next.capture !== null,
      victory: next.victory ?? null, rejection, finalCombat: next.combat,
    },
  })
}

const fixture = {
  version: 1, scenarioId: '08-korsun-pocket', seed, fingerprint: data.fingerprint,
  scenarios,
}

await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(fixture) + '\n')
const stepCount = scenarios.reduce((sum, scenario) => sum + scenario.steps.length, 0)
console.log(`已导出 08 守方撤退对照 · 场景 ${scenarios.length} · 步骤 ${stepCount} · ${resolve(output)}`)
