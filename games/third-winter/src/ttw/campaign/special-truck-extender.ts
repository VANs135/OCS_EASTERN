// TTW 3.6. One physical counter moves between these two boxes and the map.
export const steReadyBox = 'ste-ready'
export const steMovingBox = 'ste-moving'

/** TTW 3.6：苏军不得按通规 OCS 12.7 常规使用卡车延补器（只有两枚 STE）；徒步行（wagon）延补不受此限。 */
export function normalTruckExtenderRefusal(side: 'axis' | 'soviet', kind: 'truck' | 'wagon'): string | null {
  return side === 'soviet' && kind === 'truck' ? 'soviet-normal-truck-extender-forbidden' : null
}
