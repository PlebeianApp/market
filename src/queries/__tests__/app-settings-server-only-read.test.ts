import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Guard: app-settings must stay a SERVER-side read.
 *
 * `fetchAppSettings` opens its own NDK instance and fetches the kind 31990
 * handler/app-settings event directly from the relay. The browser does NOT use
 * it: the server entry (`src/index.tsx`) loads the settings once at startup and
 * re-exports the parsed result through `/api/config` (`appSettings`,
 * `appPublicKey`, `needsSetup`), which is what the client consumes.
 *
 * A client-side caller would silently reintroduce a fourth degraded authority
 * read (its own relay selection, no authority check on the client side, and a
 * second source of truth for `needsSetup`), so this test fails if any file
 * under `src/` other than the server entry imports it.
 *
 * The scan deliberately covers EVERY `.ts`/`.tsx` file under `src/`
 * (this guard file excluded, since it matches its own pattern) and asserts at
 * least one importer exists, so the guard cannot pass by scanning nothing.
 */

const SRC_DIR = fileURLToPath(new URL('../../', import.meta.url))
const GUARD_FILE = fileURLToPath(import.meta.url)
const SERVER_ENTRY_NAME = 'index.tsx'

const GUARDED_SYMBOL = 'fetchAppSettings'

/** Every `.ts`/`.tsx` file under `src/`, recursively. */
function sourceFiles(dir: string): string[] {
	const found: string[] = []
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) {
			found.push(...sourceFiles(full))
		} else if (/\.tsx?$/.test(entry)) {
			found.push(full)
		}
	}
	return found
}

/** `import ... from '...'` statements (multi-line aware). */
const IMPORT_STATEMENT = /import\s[\s\S]*?from\s*['"][^'"]+['"]/g

function importsSymbol(source: string, symbol: string): boolean {
	const statements = source.match(IMPORT_STATEMENT)
	if (statements === null) return false
	const named = new RegExp(`\\b${symbol}\\b`)
	return statements.some((statement) => named.test(statement))
}

describe('app settings are read server-side only', () => {
	const files = sourceFiles(SRC_DIR).filter((file) => file !== GUARD_FILE)
	const importers = files.filter((file) => importsSymbol(readFileSync(file, 'utf8'), GUARDED_SYMBOL)).map((file) => relative(SRC_DIR, file))

	test('the scan covers the source tree', () => {
		expect(files.length).toBeGreaterThan(100)
	})

	test(`${GUARDED_SYMBOL} is imported by the server entry and nothing else`, () => {
		expect(importers).toEqual([SERVER_ENTRY_NAME])
	})

	test('the guard is not vacuous: the server entry really does import it', () => {
		expect(importsSymbol(readFileSync(join(SRC_DIR, SERVER_ENTRY_NAME), 'utf8'), GUARDED_SYMBOL)).toBe(true)
	})
})
