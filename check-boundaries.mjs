import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve('.')
const shared = new Set(['@ocs-eastern/series', '@ocs-eastern/match-core'])
const layout = await Promise.all(['games', 'packages'].map(async (area) => ({
  area,
  entries: await readdir(join(root, area), { withFileTypes: true }),
})))
const violations = []

async function inspect(directory, unit, allowedImports) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await inspect(path, unit, allowedImports)
      continue
    }
    if (!entry.name.endsWith('.ts')) continue
    const contents = await readFile(path, 'utf8')
    const imports = contents.matchAll(/\b(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)
    for (const [, specifier] of imports) {
      const isLocal = specifier.startsWith('./') || specifier.startsWith('../')
      const dependency = specifier.split('/').slice(0, 2).join('/')
      const allowed = isLocal
        ? resolve(dirname(path), specifier).startsWith(unit + sep)
        : allowedImports.has(dependency)
      if (!allowed) {
        violations.push(`${relative(root, path)} → ${specifier}`)
      }
    }
  }
}

for (const { area, entries } of layout) {
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const unit = join(root, area, entry.name)
    const allowed = area === 'games' ? shared : new Set()
    await inspect(join(unit, 'src'), unit, allowed)
  }
}
if (violations.length) throw new Error(`Disallowed imports:\n${violations.join('\n')}`)
console.log('Source boundaries passed.')
