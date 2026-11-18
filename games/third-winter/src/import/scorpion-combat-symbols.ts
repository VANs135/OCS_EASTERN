import type { BackupUnit } from './unit-backup.ts'
import type { Definition } from './unit-catalog.ts'

// The backup's category also describes formations. Compare these TTW combat faces with OCS 3.2a.
const other = new Set([
  '1671', '1672', '1460', '1464', '1466', '1479', '1484', '1522', '1525', '1527', '1531', '1534', '1536',
  '4273', '3845', '1540', '1545', '1549', '1553', '1555', '1559', '1561', '4267', '4268', '3867', '3868',
  '1583', '1588', '4012', '4154', '1732', '1734', '1757', '1765', '1766', '1767', '1774', '1791', '1793',
  '1817', '1818', '2704', '2706', '2707', '2708', '1921', '1920', '2333', '2346', '2347',
])
const yellow = new Set(['1733', '1775', '1792', '1819', '1922'])
const redTank = new Set([
  '1729', '1730', '1754', '1755', '1762', '1771', '1772', '1788', '1789', '1814', '1816', '2701', '2703', '1918', '2292',
])
const antiTankSymbol = new Set(['1464', '1525', '1534', '1553', '1561', '1734', '1767', '1818', '2706', '1920', '1674'])

export function scorpionCombatSymbols(definition: Definition<BackupUnit>) {
  const id = definition.sourceId ?? ''
  const { category } = definition.source
  const combatClass = other.has(id) ? 'other' : yellow.has(id) ? 'armor' : redTank.has(id) ? 'mech' :
    category === 'armor' || category === 'mech' ? category : 'other'
  const heavy = combatClass === 'armor' || redTank.has(id) || antiTankSymbol.has(id) || category === 'at' || category === 'aa'
  return { combatClass, antiTank: heavy ? 2 : combatClass === 'mech' ? 1 : 0 } as const
}
