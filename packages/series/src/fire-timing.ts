import type { Phase } from './turn.ts'

// From Smolensk 06a9faa, src/engine/rules/air-mission.ts (OCS 14.2e, 14.5).
export const airMissionSegments = {
  'barrage': 'barrage',
  'hip-shoot': 'movement',
  'trainbusting': 'barrage',
  'transport': 'movement',
  'air-drop': 'movement',
  'base-transfer': 'movement',
  'fighter-sweep': 'movement',
  'interception': 'intercept-response',
} as const

export type AirMissionKind = keyof typeof airMissionSegments

type BarrageSource = 'artillery' | 'air' | 'naval'

// From Smolensk 06a9faa, src/engine/rules/legality.ts (OCS 2.2–2.3).
// The series table includes the naval sources allowed by the SOP.
const barrageSourcesByPhase: Partial<Record<Phase, readonly BarrageSource[]>> = {
  movement: ['air', 'naval'],
  reaction: ['artillery', 'air', 'naval'],
  combat: ['artillery'],
  exploitation: ['artillery', 'air', 'naval'],
}

export function allowsBarrageSource(phase: Phase, source: BarrageSource): boolean {
  return barrageSourcesByPhase[phase]?.includes(source) ?? false
}
