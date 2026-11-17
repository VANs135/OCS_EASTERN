// TTW Scenarios pp.54–56. The values below are in tokens (1 SP = 4T).
export const scorpionOpeningDumps = [
  { hex: 's1.14', side: 'soviet', tokens: 8 },
  { hex: 's3.16', side: 'soviet', tokens: 4 },
  { hex: 's5.16', side: 'soviet', tokens: 36 },
  { hex: 's21.04', side: 'soviet', tokens: 40 },
  { hex: 's21.10', side: 'soviet', tokens: 12 },
  { hex: 's3.10', side: 'axis', tokens: 2 },
  { hex: 's8.11', side: 'axis', tokens: 4 },
  { hex: 's13.11', side: 'axis', tokens: 4 },
  { hex: 's15.01', side: 'axis', tokens: 16 },
] as const

export const scorpionOpeningAirBases = [
  { hex: 's13.11', side: 'axis', level: 2 },
  { hex: 's18.07', side: 'soviet', level: 1 },
] as const
