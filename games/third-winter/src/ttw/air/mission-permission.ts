import type { Side } from '@ocs-eastern/series/state-types'

export type AirMission = 'hip-shoot' | 'fighter-sweep' | 'trainbusting' |
  'barrage' | 'facility-barrage' | 'intercept' | 'transport' | 'air-drop'

export interface SovietAircraft {
  airArmy: string | null
}

export interface FrontAirCommand {
  airArmy: string
  posture: 'offensive' | 'regrouping'
  frontDistance: number
  airArmyDistance: number
}

/** TTW 3.2a, 3.2c-d and Q08. Apply after checking series timing, aircraft and flight range. */
export function sovietMissionRestriction(
  mission: AirMission,
  aircraft: readonly SovietAircraft[],
  context: { kind: 'fronts'; commands: readonly FrontAirCommand[] } | { kind: 'scorpion'; column: number },
): 'ttw:3.2a' | 'ttw:3.2c' | 'ttw:3.2d' | 'ttw:scenario-8:p53' | null {
  if (mission === 'hip-shoot') return 'ttw:3.2a'
  const airArmies = new Set(aircraft.flatMap((plane) => plane.airArmy === null ? [] : [plane.airArmy]))
  if (airArmies.size > 1) return 'ttw:3.2d'
  if (!['fighter-sweep', 'trainbusting', 'barrage', 'facility-barrage'].includes(mission)) return null

  if (context.kind === 'scorpion') {
    for (const army of airArmies) {
      if (army === '2' && context.column <= 8) continue
      if (army === '5' && context.column >= 9) continue
      return 'ttw:scenario-8:p53'
    }
    return null
  }

  for (const plane of aircraft) {
    const commands = context.commands.filter((hq) => plane.airArmy === null || plane.airArmy === hq.airArmy)
    const inRange = commands.filter((hq) => Math.min(hq.frontDistance, hq.airArmyDistance) <= 15)
    if (inRange.length === 0) return 'ttw:3.2c'
    const postureRestricted = mission === 'fighter-sweep' || mission === 'barrage'
    if (plane.airArmy !== null && postureRestricted && inRange.every((hq) => hq.posture === 'regrouping')) {
      return 'ttw:3.2d'
    }
  }
  return null
}

export function mayHipShoot(side: Side, airframe: string): boolean {
  return side === 'axis' && (airframe === 'Ju.87' || airframe === 'Hs.129')
}
