import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'
import { applyScorpionBarrage } from '../src/match/scorpion-barrage.ts'
import { remainingSteps } from '../src/match/scorpion-losses.ts'
import { barrageColumn, barrageVolleyStrength } from '@ocs-eastern/series/tables/barrage'
import { createRngState } from '@ocs-eastern/series/rng'
import { scorpionHexDistance } from '../src/import/hex-id.ts'

// 对照夹具：第三冬地面炮兵炮击（src/match/scorpion-barrage.ts）。
// 以 08 开局真实局面为底，伪造一枚射程内有目标、可付补给、邻格有观察者的苏军炮兵；
// 跑通「声明 → 选地形 → 分配损失」，并记录拒绝路径。空中/机场/前沿炮击不在本夹具。
const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-barrage.json'), tables = dist] = process.argv.slice(2)
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const seed = 19440126
const data = await loadLocalScorpion(resolve(root), resolve(tables))
const opening = sampleScorpionOpening(data.setup, data.assets, seed)
const base = JSON.parse(JSON.stringify(opening.started.state))

const BATTERY = 'setup:land:id:2478:1'
const TARGET = 's17.04'
const DUMP = 'soviet:hex:s21.04'
const UNREACHABLE_DUMP = 'soviet:hex:s1.14'
// 距炮兵超过射程的既有轴心单位格，用于射程拒绝路径。
const FAR_TARGET = 's15.13'

function forge(rngSeed, patch) {
	const state = JSON.parse(JSON.stringify(base))
	state.cursor = { turn: 1, first: 'soviet', phasing: 'soviet', phase: 'combat', retention: 'soviet' }
	state.rng = createRngState(rngSeed)
	state.barrage = null
	state.barrageHistory = []
	if (patch) patch(state)
	return state
}

function defendersOf(state, side, hex) {
	return Object.entries(state.units)
		.filter(([, unit]) => unit.side === side && unit.combat && unit.hex === hex)
		.map(([id, unit]) => ({ id, unit }))
}

function volleyCost(state) {
	const unit = state.units[BATTERY]
	const face = unit.artillery
	const facts = [{
		id: BATTERY, strength: face.strength, printedRe: unit.printedRe,
		independentRe: Boolean(face.independentRe), remainingSteps: remainingSteps(unit),
		usedRe: 0, barrageFactor: 1, firingRe: null,
	}]
	const volley = barrageVolleyStrength(facts)
	return barrageColumn(data.board.barrage, volley.strength).cost
}

function sliceUnit(unit) {
	return {
		id: unit.id, side: unit.side, hex: unit.hex, definition: unit.definition,
		combat: unit.combat, artillery: unit.artillery ?? null, printedRe: unit.printedRe,
		stepsLost: unit.stepsLost ?? 0, formation: unit.formation ?? null,
		reserve: unit.reserve ?? null, disorganized: unit.disorganized ?? false,
		released: unit.released ?? false, exploit: unit.exploit ?? false,
		moveMode: unit.moveMode ?? false,
	}
}

function snapshot(state, ids) {
	const units = {}
	for (const id of ids) {
		if (state.units[id]) units[id] = sliceUnit(state.units[id])
	}
	const dumps = {}
	for (const [id, dump] of Object.entries(state.dumps)) {
		dumps[id] = { side: dump.side, location: dump.location, tokens: dump.tokens }
	}
	return { units, dumps, barrage: state.barrage ?? null, barrageHistory: state.barrageHistory ?? [] }
}

function involvedIds(state) {
	const ids = [BATTERY]
	for (const { id } of defendersOf(state, 'axis', TARGET)) ids.push(id)
	for (const { id } of defendersOf(state, 'soviet', TARGET)) ids.push(id)
	const near = data.assets.map.neighbors(TARGET)
	for (const [id, unit] of Object.entries(state.units)) {
		if (unit.side === 'soviet' && unit.combat && near.includes(unit.hex)) ids.push(id)
	}
	return [...new Set(ids)]
}

function rejectCode(message) {
	if (/Artillery may barrage/.test(message)) return 'barrage_phase'
	if (/Select eligible artillery/.test(message)) return 'barrage_battery'
	if (/Pay the initial column|Supply must come from|reachable friendly|on-map supply dump|cannot use that supply source/.test(message)) return 'barrage_supply'
	if (/Choose a printed terrain/.test(message)) return 'barrage_terrain'
	return 'barrage_allocation'
}

const cases = []

// 1. 成功路径：声明 → 选地形 → 分配损失（种子 2 掷出步损 1）。
{
	const state = forge(2)
	const cost = volleyCost(state)
	const actions = []
	const steps = []
	const declareAction = {
		type: 'declare-artillery-barrage',
		supply: { kind: 'direct', payments: [{ dumpId: DUMP, tokens: cost }] },
		target: TARGET, batteries: [{ unitId: BATTERY }],
	}
	let next = applyScorpionBarrage(state, 'soviet', declareAction, data.assets, data.board.barrage)
	actions.push(declareAction)
	steps.push({ after: snapshot(next, involvedIds(next)) })
	let working = next

	const terrain = data.assets.map.hexes.get(TARGET).terrains[0]
	const terrainAction = { type: 'choose-barrage-terrain', terrain }
	next = applyScorpionBarrage(working, 'axis', terrainAction, data.assets, data.board.barrage)
	actions.push(terrainAction)
	steps.push({ after: snapshot(next, involvedIds(next)) })
	working = next

	const defenders = defendersOf(working, 'axis', TARGET)
	const allocation = []
	let remainder = working.barrage.lossesDue
	for (const { id, unit } of defenders) {
		if (remainder <= 0) break
		const steps = Math.min(remainder, remainingSteps(unit))
		allocation.push({ unitId: id, steps })
		remainder -= steps
	}
	const assignAction = { type: 'assign-barrage-loss', allocation }
	next = applyScorpionBarrage(working, 'axis', assignAction, data.assets, data.board.barrage)
	actions.push(assignAction)
	steps.push({ after: snapshot(next, involvedIds(next)) })

	cases.push({ id: 'success', description: '苏军炮兵炮击 s17.04：声明、选地形、分配 1 步损失', state, actions, steps })
}

// 2. 无观察者：地面炮击不要求观察者，仅炮击表 -3 修正（与空中炮击的观察者守卫不同）。
{
	const state = forge(2, (patched) => {
		const near = data.assets.map.neighbors(TARGET)
		for (const [id, unit] of Object.entries(patched.units)) {
			if (unit.side === 'soviet' && unit.combat && near.includes(unit.hex)) delete patched.units[id]
		}
	})
	const cost = volleyCost(state)
	const actions = []
	const steps = []
	const declareAction = {
		type: 'declare-artillery-barrage',
		supply: { kind: 'direct', payments: [{ dumpId: DUMP, tokens: cost }] },
		target: TARGET, batteries: [{ unitId: BATTERY }],
	}
	let next = applyScorpionBarrage(state, 'soviet', declareAction, data.assets, data.board.barrage)
	actions.push(declareAction)
	steps.push({ after: snapshot(next, involvedIds(next)) })
	let working = next
	const terrain = data.assets.map.hexes.get(TARGET).terrains[0]
	next = applyScorpionBarrage(working, 'axis', { type: 'choose-barrage-terrain', terrain },
		data.assets, data.board.barrage)
	actions.push({ type: 'choose-barrage-terrain', terrain })
	steps.push({ after: snapshot(next, involvedIds(next)) })
	cases.push({ id: 'noSpotter', description: '邻格无苏军观察者：地面炮击仍可开火，观察者修正 -3', state, actions, steps })
}

// 3. 补给堆令牌不足：台账支付拒绝。
{
	const state = forge(2, (patched) => { patched.dumps[DUMP].tokens = 0 })
	const cost = volleyCost(state)
	const action = {
		type: 'declare-artillery-barrage',
		supply: { kind: 'direct', payments: [{ dumpId: DUMP, tokens: cost }] },
		target: TARGET, batteries: [{ unitId: BATTERY }],
	}
	let rejected = null
	try {
		applyScorpionBarrage(state, 'soviet', action, data.assets, data.board.barrage)
	} catch (error) {
		rejected = { code: rejectCode(error.message), message: error.message }
	}
	cases.push({ id: 'insufficientTokens', description: '补给堆令牌为 0，不足支付初始列位费用', state, actions: [action], steps: [], reject: rejected })
}

// 4. 补给堆不可追溯：台账 canUse 拒绝。
{
	const state = forge(2)
	const cost = volleyCost(state)
	const action = {
		type: 'declare-artillery-barrage',
		supply: { kind: 'direct', payments: [{ dumpId: UNREACHABLE_DUMP, tokens: cost }] },
		target: TARGET, batteries: [{ unitId: BATTERY }],
	}
	let rejected = null
	try {
		applyScorpionBarrage(state, 'soviet', action, data.assets, data.board.barrage)
	} catch (error) {
		rejected = { code: rejectCode(error.message), message: error.message }
	}
	cases.push({ id: 'unreachableDump', description: '补给堆不可追溯，炮兵无法使用该来源', state, actions: [action], steps: [], reject: rejected })
}

// 5. 超出射程：炮兵资格核查拒绝。
{
	const state = forge(2)
	const cost = volleyCost(state)
	const action = {
		type: 'declare-artillery-barrage',
		supply: { kind: 'direct', payments: [{ dumpId: DUMP, tokens: cost }] },
		target: FAR_TARGET, batteries: [{ unitId: BATTERY }],
	}
	let rejected = null
	try {
		applyScorpionBarrage(state, 'soviet', action, data.assets, data.board.barrage)
	} catch (error) {
		rejected = { code: rejectCode(error.message), message: error.message }
	}
	cases.push({ id: 'outOfRange', description: '目标格超出炮兵印刷射程，资格核查拒绝', state, actions: [action], steps: [], reject: rejected })
}

// 6. 阶段不允许：非战斗/反应/追击阶段拒绝。
{
	const state = forge(2, (patched) => { patched.cursor.phase = 'movement' })
	const cost = volleyCost(state)
	const action = {
		type: 'declare-artillery-barrage',
		supply: { kind: 'direct', payments: [{ dumpId: DUMP, tokens: cost }] },
		target: TARGET, batteries: [{ unitId: BATTERY }],
	}
	let rejected = null
	try {
		applyScorpionBarrage(state, 'soviet', action, data.assets, data.board.barrage)
	} catch (error) {
		rejected = { code: rejectCode(error.message), message: error.message }
	}
	cases.push({ id: 'wrongPhase', description: '移动阶段不允许炮兵炮击', state, actions: [action], steps: [], reject: rejected })
}

// 7. 同格重复炮击：本阶段历史已记录目标格，拒绝再次声明。
{
	const state = forge(2, (patched) => {
		patched.barrageHistory = [{ target: TARGET, defender: 'axis', batteries: [], strength: 0,
			initialColumn: 9, cost: 8, hedgehog: 0, turn: 1, phasing: 'soviet', phase: 'combat' }]
	})
	const cost = volleyCost(state)
	const action = {
		type: 'declare-artillery-barrage',
		supply: { kind: 'direct', payments: [{ dumpId: DUMP, tokens: cost }] },
		target: TARGET, batteries: [{ unitId: BATTERY }],
	}
	let rejected = null
	try {
		applyScorpionBarrage(state, 'soviet', action, data.assets, data.board.barrage)
	} catch (error) {
		rejected = { code: rejectCode(error.message), message: error.message }
	}
	cases.push({ id: 'repeatTarget', description: '本阶段已炮击过该格，不得重复声明', state, actions: [action], steps: [], reject: rejected })
}

// 8. 分配重复：同一单位在分配表内出现两次，拒绝。
{
	const state = forge(2)
	const cost = volleyCost(state)
	let working = applyScorpionBarrage(state, 'soviet', {
		type: 'declare-artillery-barrage',
		supply: { kind: 'direct', payments: [{ dumpId: DUMP, tokens: cost }] },
		target: TARGET, batteries: [{ unitId: BATTERY }],
	}, data.assets, data.board.barrage)
	const terrain = data.assets.map.hexes.get(TARGET).terrains[0]
	working = applyScorpionBarrage(working, 'axis', { type: 'choose-barrage-terrain', terrain },
		data.assets, data.board.barrage)
	const defenders = defendersOf(working, 'axis', TARGET)
	const first = defenders[0].id
	const action = { type: 'assign-barrage-loss', allocation: [{ unitId: first, steps: 1 }, { unitId: first, steps: 1 }] }
	let rejected = null
	try {
		applyScorpionBarrage(working, 'axis', action, data.assets, data.board.barrage)
	} catch (error) {
		rejected = { code: rejectCode(error.message), message: error.message }
	}
	cases.push({ id: 'duplicateAllocation', description: '损失分配表内同一单位重复出现', state: working, actions: [action], steps: [], reject: rejected })
}

// 9. 损失超额：分配步数超过单位存活步数，拒绝。
{
	const state = forge(2)
	const cost = volleyCost(state)
	let working = applyScorpionBarrage(state, 'soviet', {
		type: 'declare-artillery-barrage',
		supply: { kind: 'direct', payments: [{ dumpId: DUMP, tokens: cost }] },
		target: TARGET, batteries: [{ unitId: BATTERY }],
	}, data.assets, data.board.barrage)
	const terrain = data.assets.map.hexes.get(TARGET).terrains[0]
	working = applyScorpionBarrage(working, 'axis', { type: 'choose-barrage-terrain', terrain },
		data.assets, data.board.barrage)
	const defenders = defendersOf(working, 'axis', TARGET)
	const first = defenders[0].id
	const action = { type: 'assign-barrage-loss', allocation: [{ unitId: first, steps: 2 }] }
	let rejected = null
	try {
		applyScorpionBarrage(working, 'axis', action, data.assets, data.board.barrage)
	} catch (error) {
		rejected = { code: rejectCode(error.message), message: error.message }
	}
	cases.push({ id: 'overAllocation', description: '分配步数超过该单位存活步数（重 1 分派 2 步）', state: working, actions: [action], steps: [], reject: rejected })
}

// 夹具自带规则层所需的最小地图拓扑、目录与部署切片；其余盘面字段随各例 state 整盘携带。
const bundle = JSON.parse(await readFile(join(tables, 'godot', '08-opening-data.json'), 'utf8'))
const definitions = {}
for (const entry of cases) {
	for (const id of Object.keys(entry.state.units)) {
		const unit = entry.state.units[id]
		if (!definitions[unit.definition]) {
			definitions[unit.definition] = data.assets.catalog.definitions.get(unit.definition)
		}
	}
}

const fixture = {
	version: 1, scenarioId: '08-korsun-pocket', seed, fingerprint: data.fingerprint,
	barrageTable: {
		columns: data.board.barrage.columns, costs: data.board.barrage.costs, matrix: data.board.barrage.matrix,
	},
	data: {
		view: {
			mapGraph: bundle.view.mapGraph,
			catalog: { definitions },
			supplySources: bundle.view.supplySources ?? {},
			firstTurn: bundle.view.firstTurn ?? {},
		},
		deployment: {
			controlSites: bundle.deployment.controlSites ?? {},
			frontControl: bundle.deployment.frontControl ?? {},
		},
	},
	cases,
}

await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(fixture) + '\n')
const accepted = cases.filter((entry) => !entry.reject).length
const rejected = cases.length - accepted
console.log(`已导出 08 地面炮击对照 · 接受 ${accepted} 例 · 拒绝 ${rejected} 例 · ${resolve(output)}`)
