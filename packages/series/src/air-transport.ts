/** OCS 14.9e. The chosen mode ties outbound range, capacity and return together. */
export const airTransportModes = {
  extended: { range: 2, capacity: 1, stay: true },
  normal: { range: 1, capacity: 1, stay: false },
  'double-capacity': { range: 0.5, capacity: 2, stay: false },
} as const

export type AirTransportMode = keyof typeof airTransportModes
