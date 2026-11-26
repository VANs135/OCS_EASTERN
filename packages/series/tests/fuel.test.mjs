import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FUEL_FORMATION_SP, FUEL_HQ_SP, FUEL_SINGLE_UNIT_T, actionNeedsFuel, computeFuelCost, formationFuelCovers,
  fuelCanUseInternalStocks, fuelExpiresOnPhaseChange, fuelMethodAvailability, hqFuelCovers, isIndependentUnit,
  reinforcementFuelNeeded, requiresFuelToSpendMp, traceSupplyIgnoresWeatherCost,
} from '../src/fuel.ts'

// OCS §12.5 燃料：需要燃料的单位/行动、三法费用与适用、到期、独立单位与覆盖。
test('fuel requirement, three-method cost and expiry (§12.5a-d/g)', () => {
  assert.equal(requiresFuelToSpendMp({ isCombat: true, mobility: 'track' }), true)
  assert.equal(requiresFuelToSpendMp({ isCombat: true, mobility: 'leg' }), false)
  assert.equal(requiresFuelToSpendMp({ isCombat: false, mobility: 'truck' }), false)
  assert.equal(actionNeedsFuel('move'), true)
  assert.equal(actionNeedsFuel('overrun'), true)
  assert.equal(actionNeedsFuel('attack'), false)
  assert.equal(actionNeedsFuel('advanceAfterCombat'), false)
  assert.equal(fuelCanUseInternalStocks(), false)
  assert.equal(FUEL_FORMATION_SP, 1)
  assert.equal(FUEL_HQ_SP, 1)
  assert.equal(FUEL_SINGLE_UNIT_T, 1)
  const formation = computeFuelCost({ method: 'formation', commonSource: true })
  assert.equal(formation.ok && formation.sp, 1)
  assert.equal(formation.ok && formation.duration, 'untilNextFriendlyCleanUp')
  assert.equal(computeFuelCost({ method: 'formation', commonSource: false }).ok, false)
  const hq = computeFuelCost({ method: 'hq' })
  assert.equal(hq.ok && hq.marker, 'hqFuelMarker')
  const single = computeFuelCost({ method: 'singleUnit', unitsNeedingFuel: 3 })
  assert.equal(single.ok && single.t, 3)
  assert.equal(single.ok && single.duration, 'currentPhaseOnly')
  assert.equal(computeFuelCost({ method: 'singleUnit', unitsNeedingFuel: 0 }).ok, false)
  assert.equal(fuelExpiresOnPhaseChange('singleUnit'), true)
  assert.equal(fuelExpiresOnPhaseChange('formation'), false)
  assert.equal(fuelExpiresOnPhaseChange('hq'), false)
  // 注入式可选专规闸门优先。
  const overridden = computeFuelCost({ method: 'formation', commonSource: true,
    optionalOverride: () => ({ ok: true, sp: 0, t: 2, duration: 'currentPhaseOnly', marker: 'formationMarker', rule: '4.2c' }) })
  assert.equal(overridden.ok && overridden.t, 2)
})

test('independent units, method availability, coverage and reinforcement (§3.2f/12.5c/e/f)', () => {
  assert.equal(isIndependentUnit({ formation: null, printedSteps: 1 }), true)
  assert.equal(isIndependentUnit({ formation: 'X', printedSteps: 1 }), false)
  assert.equal(isIndependentUnit({ formation: null, printedSteps: 2 }), false)
  assert.equal(hqFuelCovers({ targetIsTheHq: true, targetIsIndependent: false }), true)
  assert.equal(hqFuelCovers({ targetIsTheHq: false, targetIsIndependent: true }), true)
  assert.equal(hqFuelCovers({ targetIsTheHq: false, targetIsIndependent: false }), false)
  assert.equal(formationFuelCovers({ unitFormation: 'X', fuelFormation: 'X' }), true)
  assert.equal(formationFuelCovers({ unitFormation: 'Y', fuelFormation: 'X' }), false)
  const avail = fuelMethodAvailability({ targets: [{ isHq: true, formation: null, isIndependent: false }] })
  assert.equal(avail.find((a) => a.method === 'hq').available, true)
  assert.equal(avail.find((a) => a.method === 'formation').available, false)
  assert.equal(avail.find((a) => a.method === 'singleUnit').available, true)
  assert.equal(reinforcementFuelNeeded({ stillInEntryHex: true }).needsFuel, false)
  assert.equal(reinforcementFuelNeeded({ stillInEntryHex: false }).needsFuel, true)
  assert.equal(traceSupplyIgnoresWeatherCost(), true)
})