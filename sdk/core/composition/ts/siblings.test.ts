/**
 * composition/ts/siblings.test.ts — **the rung's own independence criterion, as a checkable fact**.
 *
 * The composition root may name its siblings — that is its job (`design.md` §4.9) — but only the ones
 * it declares. This case extracts every import specifier out of this directory and asserts:
 *
 * 1. every relative specifier that leaves the directory is on `COMPOSITION_SIBLINGS` (nothing smuggled
 *    in), and
 * 2. every entry on `COMPOSITION_SIBLINGS` is actually used (no stale licence), and
 * 3. no specifier is an app import or a framework import (`@/`, `@ui/`, `@platform/`, `react*`) —
 *    the `sdk/boundary.test.ts` rule, restated at the rung so the rung owns its own answer.
 *
 * **The mutation that turns it red:** add a fourth relative sibling import to any file here without
 * listing it → arm 1 fails; delete the harness import from the moved suite → arm 2 fails; import
 * `@/lib/schemas/auction/auctionEvent` → arm 3 fails.
 */
import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { COMPOSITION_SIBLINGS } from './siblings'

const HERE = import.meta.dir
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const IMPORT_SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g
const FORBIDDEN_MODULES = /^(?:react|react-dom|@tanstack\/|@\/|@ui\/|@platform\/)/

async function specifiers(): Promise<Map<string, string[]>> {
  const entries = await readdir(HERE, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.'))))
    .map((entry) => entry.name)
  const found = new Map<string, string[]>()
  for (const file of files) {
    const source = await readFile(join(HERE, file), 'utf8')
    const list: string[] = []
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1] ?? match[2]
      if (specifier) list.push(specifier)
    }
    found.set(file, list)
  }
  return found
}

describe('the composition rung declares every sibling it composes', () => {
  test('every relative specifier leaving the directory is declared, and every declared sibling is used', async () => {
    const found = await specifiers()
    const leaving = new Set<string>()
    for (const list of found.values()) {
      for (const specifier of list) if (specifier.startsWith('../')) leaving.add(specifier)
    }
    const declared = new Set<string>(COMPOSITION_SIBLINGS)

    // Arm 1 — a sibling import nothing declares is exactly the violation the rung exists to prevent.
    expect([...leaving].filter((specifier) => !declared.has(specifier))).toEqual([])
    // Arm 2 — a declared sibling nothing imports is a stale licence, not a fact.
    expect([...declared].filter((specifier) => !leaving.has(specifier))).toEqual([])
  })

  test('no specifier is an app import or a framework import', async () => {
    const found = await specifiers()
    const violations: string[] = []
    for (const [file, list] of found) {
      for (const specifier of list) if (FORBIDDEN_MODULES.test(specifier)) violations.push(`${file} imports ${specifier}`)
    }
    expect(violations).toEqual([])
  })
})
