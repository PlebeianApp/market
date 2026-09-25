import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

import {
	COCO_CORE_ARCHIVE_SHA256,
	COCO_CORE_INSTALLED_CONTENT_HASH,
	COCO_INDEXEDDB_ARCHIVE_SHA256,
	COCO_INDEXEDDB_INSTALLED_CONTENT_HASH,
	COCO_ROUND_14_SHA,
	COCO_VENDOR_DIRECTORY,
	installedContentHash,
} from './coco-artifact-contract'

const root = resolve(import.meta.dir, '..')
const expectedEntrypoints = new Set(['src/lib/coco/runtime.ts', 'src/lib/stores/cashu.ts'])

function invariant(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`COCO_PRODUCTION_PROFILE_REJECTED: ${message}`)
}

async function regularFiles(directory: string): Promise<string[]> {
	const files: string[] = []
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name)
		if (entry.isSymbolicLink()) continue
		if (entry.isDirectory()) files.push(...(await regularFiles(path)))
		else if (entry.isFile()) files.push(path)
	}
	return files
}

async function dependencySymlinks(directory: string): Promise<string[]> {
	const links: string[] = []
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name)
		if (entry.isSymbolicLink()) links.push(path)
		else if (entry.isDirectory()) links.push(...(await dependencySymlinks(path)))
	}
	return links
}

async function sha256(path: string): Promise<string> {
	return createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
}

async function auditSource(): Promise<void> {
	const sourceFiles = (await regularFiles(join(root, 'src'))).filter((path) => {
		const rel = relative(root, path)
		return /\.[cm]?[jt]sx?$/.test(path) && !rel.includes('/__tests__/') && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
	})
	const constructors: string[] = []
	for (const path of sourceFiles) {
		const rel = relative(root, path)
		const text = await readFile(path, 'utf8')
		invariant(!/\bMemoryRepositories\b/.test(text), `${rel} references Core MemoryRepositories`)
		invariant(
			!/(?:import\s*\(|require\s*\()\s*['"]@cashu\/coco-(?:core|indexeddb)['"]/.test(text),
			`${rel} dynamically loads a Coco persistence package`,
		)
		for (const _match of text.matchAll(/new\s+IndexedDbRepositories\s*\(/g)) constructors.push(rel)
	}
	invariant(constructors.length === 2, `expected two IndexedDbRepositories constructors, found ${constructors.length}`)
	invariant(
		constructors.every((path) => expectedEntrypoints.has(path)) && [...expectedEntrypoints].every((path) => constructors.includes(path)),
		`unexpected IndexedDbRepositories constructor locations: ${constructors.join(', ')}`,
	)
	for (const rel of expectedEntrypoints) {
		const text = await readFile(join(root, rel), 'utf8')
		invariant(/from\s+['"]@cashu\/coco-indexeddb['"]/.test(text), `${rel} does not statically import the IndexedDB adapter`)
		invariant(/new\s+IndexedDbRepositories\s*\(/.test(text), `${rel} does not construct IndexedDbRepositories`)
		invariant(!/\bMemoryRepositories\b/.test(text), `${rel} contains a memory fallback`)
	}
}

async function auditArtifacts(): Promise<void> {
	const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
	const expectedCorePin = `file:${COCO_VENDOR_DIRECTORY}/cashu-coco-core-2.0.0.tgz`
	const expectedIndexedDbPin = `file:${COCO_VENDOR_DIRECTORY}/cashu-coco-indexeddb-2.0.0.tgz`
	invariant(packageJson.dependencies?.['@cashu/coco-core'] === expectedCorePin, 'Core dependency is not pinned to Round 14')
	invariant(packageJson.dependencies?.['@cashu/coco-indexeddb'] === expectedIndexedDbPin, 'IndexedDB dependency is not pinned to Round 14')
	for (const [name, specifier] of Object.entries(packageJson.dependencies ?? {})) {
		if (name === '@cashu/coco-core' || name === '@cashu/coco-indexeddb') continue
		invariant(!/^\s*(?:file:|link:|workspace:|\/|\.\.?\/)/.test(specifier), `${name} uses a forbidden local runtime dependency specifier`)
	}

	const vendorDirectories = (await readdir(join(root, 'vendor'), { withFileTypes: true }))
		.filter((entry) => entry.isDirectory() && entry.name.startsWith('coco-'))
		.map((entry) => entry.name)
	invariant(
		vendorDirectories.length === 1 && vendorDirectories[0] === `coco-${COCO_ROUND_14_SHA}`,
		`unexpected Coco vendor directories: ${vendorDirectories.join(', ')}`,
	)

	const coreArchive = join(root, COCO_VENDOR_DIRECTORY, 'cashu-coco-core-2.0.0.tgz')
	const indexedDbArchive = join(root, COCO_VENDOR_DIRECTORY, 'cashu-coco-indexeddb-2.0.0.tgz')
	invariant((await sha256(coreArchive)) === COCO_CORE_ARCHIVE_SHA256, 'Core archive checksum mismatch')
	invariant((await sha256(indexedDbArchive)) === COCO_INDEXEDDB_ARCHIVE_SHA256, 'IndexedDB archive checksum mismatch')

	const installedCore = join(root, 'node_modules/@cashu/coco-core')
	const installedIndexedDb = join(root, 'node_modules/@cashu/coco-indexeddb')
	invariant((await installedContentHash(installedCore)) === COCO_CORE_INSTALLED_CONTENT_HASH, 'installed Core content mismatch')
	invariant(
		(await installedContentHash(installedIndexedDb)) === COCO_INDEXEDDB_INSTALLED_CONTENT_HASH,
		'installed IndexedDB content mismatch',
	)
	for (const packageRoot of [installedCore, installedIndexedDb]) {
		const packageStat = await lstat(packageRoot)
		invariant(!packageStat.isSymbolicLink(), `${relative(root, packageRoot)} is a symlink`)
		invariant(
			!(await regularFiles(packageRoot)).some((path) => path.endsWith('.map')),
			`${relative(root, packageRoot)} contains source maps`,
		)
	}

	const emittedAdapter = await readFile(join(installedIndexedDb, 'dist/index.js'), 'utf8')
	invariant(
		emittedAdapter.includes('const nativeDefineProperty = Object.defineProperty;') &&
			emittedAdapter.includes('const nativeDefineProperties = Object.defineProperties;'),
		'IndexedDB adapter does not snapshot attachment intrinsics',
	)
	invariant(
		emittedAdapter.includes('nativeDefineProperties(this') && emittedAdapter.includes('nativeDefineProperty(this'),
		'IndexedDB adapter does not use captured intrinsics for repository attachment',
	)
	invariant(
		!emittedAdapter.includes('Object.defineProperties(this') && !emittedAdapter.includes('Object.defineProperty(this'),
		'IndexedDB adapter uses mutable live globals for repository attachment',
	)
}

async function auditDependencyGraph(): Promise<void> {
	const relevantSymlinks = (await dependencySymlinks(join(root, 'node_modules'))).filter((path) =>
		/(?:^|[/\\])@cashu[/\\](?:cashu-ts|coco-(?:core|indexeddb))(?:$|[/\\])/.test(path),
	)
	invariant(relevantSymlinks.length === 0, `Coco runtime dependency symlinks found: ${relevantSymlinks.join(', ')}`)
	const packageFiles = (await regularFiles(join(root, 'node_modules'))).filter((path) => basename(path) === 'package.json')
	const cashuTs: Array<{ path: string; version: string }> = []
	const forbiddenPackages: string[] = []
	for (const path of packageFiles) {
		let manifest: { name?: string; version?: string }
		try {
			manifest = JSON.parse(await readFile(path, 'utf8')) as { name?: string; version?: string }
		} catch {
			continue
		}
		if (manifest.name === '@cashu/cashu-ts') cashuTs.push({ path: relative(root, dirname(path)), version: manifest.version ?? '' })
		const name = manifest.name?.toLowerCase() ?? ''
		if (name === 'npc' || name.endsWith('/npc') || name.includes('cocod')) forbiddenPackages.push(name)
	}
	invariant(cashuTs.length === 1, `expected one physical @cashu/cashu-ts, found ${JSON.stringify(cashuTs)}`)
	invariant(cashuTs[0].version === '5.0.0-rc.4', `unexpected @cashu/cashu-ts version ${cashuTs[0].version}`)
	invariant(forbiddenPackages.length === 0, `forbidden dependency packages found: ${forbiddenPackages.join(', ')}`)
}

async function auditBundle(): Promise<void> {
	const files = await regularFiles(join(root, 'dist'))
	invariant(!files.some((path) => path.endsWith('.map')), 'production bundle contains source maps')
	const javascript = files.filter((path) => /\.(?:js|mjs|cjs)$/.test(path))
	invariant(javascript.length > 0, 'production bundle contains no JavaScript')
	const bundle = (await Promise.all(javascript.map((path) => readFile(path, 'utf8')))).join('\n')
	for (const marker of [
		'MemoryRepositories',
		'MemoryRepositoryBackend',
		'create another runtime root over the same durable in-memory database',
		'pendingTransactionCount',
		'activeRootOperationCount',
		'rootOperationsIdle',
		'createMemoryRepositoryState',
		'cloneMemoryRepositoryState',
		'copyMemoryRepositoryState',
	]) {
		invariant(!bundle.includes(marker), `production bundle contains Core memory marker ${marker}`)
	}
	for (const marker of [
		'Nested IndexedDB Wallet transactions are not supported',
		'coco_cashu_wallet_authority',
		'coco_cashu_send_operations',
		'plebeian_coco_v2_',
		'cashu_wallet_',
	]) {
		invariant(bundle.includes(marker), `production bundle lacks IndexedDB marker ${marker}`)
	}
}

export async function auditCocoProductionProfile(): Promise<void> {
	await auditSource()
	await auditArtifacts()
	await auditDependencyGraph()
	await auditBundle()
	console.log(
		JSON.stringify({
			status: 'COCO_PRODUCTION_PROFILE_ACCEPTED',
			coreGitSha: COCO_ROUND_14_SHA,
			coreInstalledContentHash: COCO_CORE_INSTALLED_CONTENT_HASH,
			indexeddbInstalledContentHash: COCO_INDEXEDDB_INSTALLED_CONTENT_HASH,
			persistence: 'IndexedDbRepositories',
			cashuTs: '5.0.0-rc.4',
			memoryRepositoriesInProductionPath: false,
		}),
	)
}

if (import.meta.main) await auditCocoProductionProfile()
