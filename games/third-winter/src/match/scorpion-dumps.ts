import { inScorpionPhase, scorpionPhaseAirMissions } from './scorpion-barrage-timing.ts'
import type { SupplyDump } from './scorpion-reinforcement-state.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'

/** OCS 12.2a. Unloaded supply stays usable, but cannot be loaded again until the next phase. */
export function scorpionUnloadedTokens(state: Readonly<ScorpionInPlay>, id: string, dump: SupplyDump) {
  if (dump.unloaded) return inScorpionPhase(state.cursor, dump.unloaded) ? Math.min(dump.tokens, dump.unloaded.tokens) : 0
  if (dump.location !== 'on-map') return 0
  // Older saves recorded deliveries in the mission log without tracking provenance in the dump.
  const delivered = scorpionPhaseAirMissions(state).reduce((total, mission) =>
    mission.target.kind === 'hex' && id === `${mission.side}:hex:${mission.target.hex}` && !mission.airlift?.source
      ? total + (mission.airlift?.unloading?.delivered ?? 0) : total, 0)
  return Math.min(dump.tokens, delivered)
}

/** OCS 12.2b. Spend recently unloaded tokens first and leave older supply available for transport. */
export function spendScorpionDump(state: Readonly<ScorpionInPlay>, id: string, dump: SupplyDump, tokens: number): SupplyDump {
  const restricted = scorpionUnloadedTokens(state, id, dump)
  if (restricted === 0) return { ...dump, tokens: dump.tokens - tokens }
  const { turn, phasing, phase } = state.cursor
  return { ...dump, tokens: dump.tokens - tokens, unloaded: { turn, phasing, phase, tokens: Math.max(0, restricted - tokens) } }
}
