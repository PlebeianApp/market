import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')
const PLATFORM_ROOT = resolve(import.meta.dir)
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const TEST_FILE = /(?:\.test|\.spec)\.(?:ts|tsx|mts|cts)$/
const IMPORT_SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g

// Known coupling to remove: browser routes reading server pricing constants.
const WEB_TO_SERVER_ALLOWLIST = new Set([
	'platform/web/routes/_dashboard-layout/dashboard/account/nostr-address.tsx',
	'platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx',
])

// Legacy src/ host modules allowed to depend on Platform while they are migrated; do not grow this list
// except for publish adapters that now delegate to SDK workflows via the Platform publish context.
const SRC_TO_PLATFORM_ALLOWLIST = new Set([
	'src/index.tsx',
	'src/lib/boot.ts',
	'src/publish/shipping.tsx',
	'src/publish/products.tsx',
	'src/publish/collections.tsx',
	'src/publish/orders.tsx',
	'src/queries/shipping.tsx',
	'src/queries/products.tsx',
	'src/publish/comments.tsx',
	'src/publish/liveChat.tsx',
	'src/publish/reactions.tsx',
	'src/publish/shareNotes.ts',
	'src/publish/profiles.tsx',
	'src/publish/relay-list.tsx',
	'src/publish/relay-preferences.tsx',
	'src/publish/cart.tsx',
	'src/publish/wallet.tsx',
	'src/publish/nip89.ts',
	'src/publish/migration.tsx',
	'src/publish/curationContext.ts',
])

async function listSourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true })
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = join(directory, entry.name)
			if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listSourceFiles(fullPath)
			const extension = entry.name.slice(entry.name.lastIndexOf('.'))
			return SOURCE_EXTENSIONS.has(extension) && !TEST_FILE.test(entry.name) ? [fullPath] : []
		}),
	)
	return nested.flat()
}

async function collectImports(root: string) {
	const files = await listSourceFiles(root)
	const results: { file: string; specifier: string }[] = []
	for (const file of files) {
		const source = await readFile(file, 'utf8')
		for (const match of source.matchAll(IMPORT_SPECIFIER)) {
			const specifier = match[1] ?? match[2]
			if (specifier) results.push({ file, specifier })
		}
	}
	return results
}

const repoPath = (file: string) => relative(REPO_ROOT, file).split(sep).join('/')

describe('Platform dependency boundary', () => {
	test('platform modules use aliases instead of relative paths that leave platform/', async () => {
		const violations = (await collectImports(PLATFORM_ROOT))
			.filter(({ file, specifier }) => {
				if (!specifier.startsWith('.')) return false
				const rel = relative(PLATFORM_ROOT, resolve(file, '..', specifier))
				return rel === '..' || rel.startsWith(`..${sep}`)
			})
			.map(({ file, specifier }) => `${repoPath(file)} escapes platform/: ${specifier}`)
		expect(violations).toEqual([])
	})

	test('server code does not import the web host or React', async () => {
		const violations = (await collectImports(join(PLATFORM_ROOT, 'server')))
			.filter(({ specifier }) => /^(?:@platform\/web|react(?:-dom)?(?:\/|$)|@ui\/)/.test(specifier))
			.map(({ file, specifier }) => `${repoPath(file)} imports ${specifier}`)
		expect(violations).toEqual([])
	})

	test('web code does not pull server modules into the browser bundle', async () => {
		const violations = (await collectImports(join(PLATFORM_ROOT, 'web')))
			.filter(({ file, specifier }) => specifier.startsWith('@platform/server') && !WEB_TO_SERVER_ALLOWLIST.has(repoPath(file)))
			.map(({ file, specifier }) => `${repoPath(file)} imports ${specifier}`)
		expect(violations).toEqual([])
	})

	test('legacy src/ code only depends on Platform from the allowlisted host modules', async () => {
		const violations = (await collectImports(join(REPO_ROOT, 'src')))
			.filter(({ file, specifier }) => specifier.startsWith('@platform/') && !SRC_TO_PLATFORM_ALLOWLIST.has(repoPath(file)))
			.map(({ file, specifier }) => `${repoPath(file)} imports ${specifier}`)
		expect(violations).toEqual([])
	})
})
