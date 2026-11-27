import type { SetupPlan, SetupRules, SetupStep } from '@ocs-eastern/series/setup-workflow'
import type { Side } from '@ocs-eastern/series/state-types'
import type { loadKirovogradScenario } from '../import/kirovograd-scenario.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'
import { kirovogradDates, kirovogradScenario, kirovogradTankCorps, kirovogradTankCorpsHold } from '../ttw/campaign/kirovograd.ts'
import type { CampaignOpeningContext } from './campaign-opening-session.ts'
import type { CampaignMatchOpening } from './campaign-match.ts'
import type { CampaignCounter } from './campaign-reinforcement-state.ts'
import type { CampaignTurnContext } from './campaign-turn-state.ts'
import { kirovogradSetupTransports } from './kirovograd-setup-transports.ts'
import { kirovogradReleaseRule } from './kirovograd-release.ts'
import { kirovogradScenarioVictory } from './kirovograd-scenario-victory.ts'
import { campaignControlRecorder } from './campaign-control.ts'
import { kirovogradReinforcementSupply } from './kirovograd-reinforcement-supply.ts'
import { kirovogradRailBoard } from './kirovograd-rail-board.ts'
import { kirovogradEdgeSupplySources } from './kirovograd-supply.ts'
import { kirovogradAirStrikeBoard } from './kirovograd-air-strike-board.ts'

type KirovogradData = Awaited<ReturnType<typeof loadKirovogradScenario>>

function groundCounter(definition: Definition<BackupUnit> | undefined, side: Side, stepsLost = 0, face: string | null = null): CampaignCounter {
  if (!definition || definition.source.side !== side ||
    (definition.kind !== 'land' && definition.kind !== 'hq' && definition.kind !== 'transport') ||
    (face !== null && face !== 'combat' && face !== 'move')) throw new Error('Invalid Kirovograd ground definition or face')
  const re = definition.source.re
  if (typeof re !== 'number' || !Number.isFinite(re) || re < 0 || !Number.isSafeInteger(stepsLost) || stepsLost < 0 ||
    (stepsLost > 0 && stepsLost >= re)) throw new Error(`Invalid Kirovograd loss state: ${definition.key}`)
  return { definition: definition.key, side, kind: definition.kind, location: { kind: 'available' },
    stepsLost, currentRe: re - stepsLost, mode: face ?? 'combat' }
}

function assertPrepared(data: KirovogradData) {
  const setup = data.setup
  if ([setup.unresolvedSetup, setup.unresolvedLosses, setup.missingSetupHexes, setup.outsideSetupArea,
    setup.unresolvedDraws, setup.pendingMarkerRows, data.diagnostics.missingTerrain].some((rows) => rows.length)) {
    throw new Error('Resolve Kirovograd setup diagnostics before opening a session')
  }
  if (data.setupOrder.length !== 2 || new Set(data.setupOrder).size !== 2) throw new Error('Invalid Kirovograd setup order')
}

/** Bind reviewed scenario rows to actual instances and the shared setup workflow. */
export function prepareKirovogradOpening(data: KirovogradData, turnRules: Partial<CampaignTurnContext> = {}) {
  assertPrepared(data)
  const counters: Record<string, CampaignCounter> = {}
  const add = (id: string, counter: CampaignCounter) => {
    if (Object.hasOwn(counters, id)) throw new Error(`Duplicate Kirovograd counter ID: ${id}`)
    counters[id] = counter
  }
  for (const row of data.setup.counters) {
    const definition = data.catalog.definitions.get(row.definition)
    // Scenario Book p.64. The 29th Tank Corps starts unable to move.
    const corps = row.side === 'soviet' && definition?.source.org?.parentFmt === kirovogradTankCorps.formation
    add(row.id, { ...groundCounter(definition, row.side, row.stepsLost, row.face), location: { kind: 'map', hex: row.hex },
      ...(corps ? { held: kirovogradTankCorpsHold } : {}) })
  }
  for (const aircraft of data.aircraft) {
    add(aircraft.id, { definition: aircraft.definition, kind: 'aircraft', side: aircraft.side,
      location: { kind: 'box', box: `09:${aircraft.side}:air` }, active: true, stepsLost: aircraft.reduced ? 1 : 0,
      availableThrough: aircraft.availableThrough })
  }
  const transports = kirovogradSetupTransports(data)
  for (const [id, counter] of Object.entries(transports.counters)) add(id, counter)

  const alertIds: string[] = []
  for (const row of data.alertPool) {
    for (let copy = 1; copy <= row.count; copy++) {
      const id = `09:alert:${row.definition}:${copy}`
      add(id, groundCounter(data.catalog.definitions.get(row.definition), 'axis'))
      alertIds.push(id)
    }
  }
  const bindings = new Map<string, readonly string[]>()
  for (const order of data.reinforcement.entries) {
    if (order.status !== 'classified' || order.operation.kind !== 'arrival' || order.counterKind === 'aircraft') {
      throw new Error(`Unbound Kirovograd reinforcement: ${order.id}`)
    }
    const id = `09:arrival:${order.id}`
    add(id, groundCounter(data.catalog.definitions.get(order.definition), order.side))
    bindings.set(order.id, [id])
  }

  const steps: SetupStep[] = []
  const placementIds = new Set<string>()
  for (const side of data.setupOrder) {
    for (const placement of data.placements) {
      const counter = counters[placement.id]
      if (!counter) throw new Error(`Unknown Kirovograd placement: ${placement.id}`)
      if (counter.side !== side) continue
      if (placementIds.has(placement.id)) throw new Error(`Duplicate Kirovograd placement: ${placement.id}`)
      placementIds.add(placement.id)
      steps.push({ id: `09:place:${placement.id}`, side, kind: 'place', counterId: placement.id, destinations: placement.choices })
      // These positions are selected during setup. Unplaced counters do not occupy the printed center.
      counters[placement.id] = { ...counter, location: { kind: 'available' } }
    }
    for (const draw of data.setup.drawOrders) {
      if (draw.side !== side) continue
      if (draw.pool !== 'alert' || side !== 'axis' || draw.count === undefined) throw new Error(`Unsupported Kirovograd setup draw: ${draw.row}`)
      steps.push({ id: `09:draw:${draw.row}`, side, kind: 'draw', pool: '09:axis:alert', count: draw.count, hex: draw.hex })
    }
    steps.push({ id: `09:confirm:${side}`, side, kind: 'confirm' })
  }
  const setupPlan: SetupPlan = { steps, pools: { '09:axis:alert': { side: 'axis', counterIds: alertIds } } }
  const setupRules: SetupRules<CampaignCounter> = {
    isHex: (hex) => data.map.resolveHex(hex) === hex,
    canPlace: (board, id, hex) => {
      const candidate = board[id]
      if (!candidate) return false
      let re = candidate.currentRe ?? 0
      for (const [otherId, counter] of Object.entries(board)) {
        if (otherId === id || counter.location.kind !== 'map' || counter.location.hex !== hex) continue
        if (counter.side !== candidate.side) return false
        re += counter.currentRe ?? 0
      }
      return re <= 10
    },
    place: (counter, hex) => ({ ...counter, location: { kind: 'map', hex } }),
  }
  // The city starts Axis-held; the shared recorder adds the one-time liberation event when a Soviet combat unit passes through.
  const city = data.map.resolveHex(data.kirovogradHex) ?? data.kirovogradHex
  const recordCity = campaignControlRecorder(new Set([city]))
  const baseMovement = turnRules.groundMovement
  const edgeSupplySources = kirovogradEdgeSupplySources(data.map)
  // Reuse the scenario's loaded barrage table and the actual air unit definitions
  // to assemble the 09 air-strike board without a second table source.
  const airMission = turnRules.airMission ?? (turnRules.barrage
    ? kirovogradAirStrikeBoard({ map: data.map, table: turnRules.barrage.table, definitions: data.catalog.definitions })
    : undefined)
  const groundMovement = baseMovement ? { ...baseMovement,
    afterMove: (state: Parameters<typeof recordCity>[0], side: Side,
    move: Parameters<typeof recordCity>[2]) => {
      const recorded = recordCity(state, side, move)
      return baseMovement.afterMove ? baseMovement.afterMove(recorded, side, move) : recorded
    } } : undefined
  const context: CampaignOpeningContext = { setupPlan, setupRules, turn: { ...turnRules,
    ...(groundMovement ? { groundMovement } : {}),
    ...(airMission ? { airMission } : {}),
    reinforcement: { ...turnRules.reinforcement, schedule: data.reinforcement.schedule, bindings,
      resolveHex: (hex) => data.map.resolveHex(hex), arrivalSites: turnRules.reinforcement?.arrivalSites ?? (() => []),
      ...kirovogradReinforcementSupply(data) },
    scenarioVictory: turnRules.scenarioVictory ?? kirovogradScenarioVictory({ map: data.map,
      definitions: data.catalog.definitions, kirovogradHex: data.kirovogradHex }),
    // p.62: Kirovograd has zero rail capacity; bind it to the shared rail checks.
    railTransport: turnRules.railTransport ?? kirovogradRailBoard(),
    // p.62: Scenario 9 aircraft refit off-map without spending supply points.
    aircraftRefit: turnRules.aircraftRefit ?? {
      bases: () => [],
      offMapBoxes: (_state, side) => data.aircraft.some((aircraft) => aircraft.side === side)
        ? [`09:${side}:air`] : [],
    },
    roundEnd: turnRules.roundEnd ?? ((cleaned) => {
      if (cleaned.when.scenarioId !== kirovogradScenario) return undefined
      return cleaned.turn >= kirovogradDates.length ? { kind: 'ended' as const }
        : { kind: 'continue' as const, date: kirovogradDates[cleaned.turn]! }
    }),
  } }
  const opening: CampaignMatchOpening = { when: { scenarioId: kirovogradScenario, date: data.dates[0] }, turn: 1,
    opening: data.opening, counters, supplyDumps: data.supplyDumps, edgeSupplySources,
    hexControl: { [city]: 'axis' } }
  return { opening, context, markerSetup: transports.pendingMarkers,
    aircraftAvailability: data.aircraft.map(({ id, availableThrough }) => ({ id, availableThrough })),
    movement: { releases: kirovogradReleaseRule({ map: data.map, definitions: data.catalog.definitions, kirovogradHex: data.kirovogradHex }) } }
}
