export const bulkFuelCost = 4
export const singleUnitFuelCost = 1

/** OCS 3.2f. Use printed size, including when a multi-step unit is reduced. */
export function isIndependent(formation: string | undefined, printedSteps: number) {
  return !formation && printedSteps <= 1
}

/** OCS 13.2f. Each loading or unloading operation costs 10% of printed MA. */
export function transportHandlingCost(printedAllowance: number) {
  return Math.round(printedAllowance / 10)
}
