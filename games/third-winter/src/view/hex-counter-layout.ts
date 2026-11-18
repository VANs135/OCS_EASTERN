const pageSize = 4
const positions = [
  [],
  [[0, 0]],
  [[-23, 0], [23, 0]],
  [[-19, -19], [19, -19], [0, 19]],
  [[-19, -19], [19, -19], [-19, 19], [19, 19]],
] as const

export function hexCounterPages<Counter>(counters: readonly Counter[], scale = 1) {
  const pages = []
  for (let first = 0; first < counters.length; first += pageSize) {
    const page = counters.slice(first, first + pageSize)
    const size = page.length === 1 ? 68 : page.length === 2 ? 42 : 34
    pages.push(page.map((counter, index) => {
      const [x, y] = positions[page.length]![index]!
      return { ...counter, x: x * scale, y: y * scale, size: size * scale }
    }))
  }
  return pages
}
