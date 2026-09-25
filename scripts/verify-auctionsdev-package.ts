import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
	COCO_CORE_ARCHIVE_SHA256,
	COCO_CORE_INSTALLED_CONTENT_HASH,
	COCO_CORE_SHA,
	COCO_INDEXEDDB_ARCHIVE_SHA256,
	COCO_INDEXEDDB_INSTALLED_CONTENT_HASH,
	COCO_VENDOR_DIRECTORY,
} from './coco-artifact-contract'
import {
	type BoundFreshAuctionsdevPreflightEvidence,
	validateBoundFreshWalletPreflightEvidence,
} from './check-auctionsdev-fresh-wallet-result'
import { type BoundCocoAuctionsdevSmokeEvidence, validateBoundAuctionsdevSmokeEvidence } from './check-auctionsdev-smoke-result'

const BUN_VERSION = '1.4.2'
const CASHU_TS_VERSION = '5.0.0-rc.4'
const CORE_PACKAGE = '@cashu/coco-core'
const INDEXED_DB_PACKAGE = '@cashu/coco-indexeddb'
const CASHU_TS_PACKAGE = '@cashu/cashu-ts'
const FAKE_MINT_VERSION = '0.17.0-rc.0'
const FAKE_MINT_SHA256 = {
	x86_64: 'd6868866b0b0873faa527d7cc949427c6e3d4e2a0b92b2ec6a99319c9f33eb29',
	aarch64: 'f958ea46608accd1e3525ebb3469915a88143762c5e062191ecbd8d3bbdca3cf',
} as const

interface PackageJson {
	name?: string
	version?: string
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	optionalDependencies?: Record<string, string>
	peerDependencies?: Record<string, string>
}

export interface SealedBunLockArchive {
	workspaceSpecifier: string
	packageResolution: string
}

type SealedBunLockArchives = Readonly<Record<string, SealedBunLockArchive>>

interface PackageIdentity {
	name: string
	version: string
	sha256: string
	physicalPath: string
	symlinked: false
}

interface DeploymentManifest {
	schemaVersion: 4
	marketGitSha: string
	marketGitTree: string
	coreGitSha: string
	archives: {
		cocoCore: { path: string; sha256: string }
		cocoIndexedDb: { path: string; sha256: string }
	}
	cocoPackageIdentity: string
	packages: {
		cocoCore: PackageIdentity
		cocoIndexedDb: PackageIdentity
		cashuTs: PackageIdentity & { version: typeof CASHU_TS_VERSION }
	}
	dependencyTree: Array<{
		consumer: string
		requirement: string
		resolvedName: string
		resolvedVersion: string
		physicalPath: string
	}>
	physicalCopies: Record<'cocoCore' | 'cocoIndexedDb' | 'cashuTs', 1>
	bunVersion: string
	bunLockSha256: string
	fakeMint: { name: 'cdk-mintd'; version: string; sha256: typeof FAKE_MINT_SHA256 }
	freshAuctionsdevTest: BoundFreshAuctionsdevPreflightEvidence & { sha256: string }
	cocoAuctionsdevSmoke: BoundCocoAuctionsdevSmokeEvidence & { sha256: string }
	environment: 'auctionsdev'
	monetaryMode: 'coco-test'
	mintMode: 'fake'
	realFundsEnabled: false
}

interface PackageOccurrence {
	packageJson: PackageJson
	physicalDirectory: string
	physicalPath: string
	symlinked: boolean
}

const readArg = (name: string): string | undefined => {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

const requiredArg = (name: string): string => {
	const value = readArg(name)
	if (!value) throw new Error(`Missing required argument: ${name}`)
	return value
}

const assertSha256 = (label: string, value: string): void => {
	if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
}

const hashFile = async (file: string): Promise<string> =>
	createHash('sha256')
		.update(await readFile(file))
		.digest('hex')

export const hashPackageDirectory = async (directory: string): Promise<string> => {
	const files: string[] = []
	const collect = async (current: string): Promise<void> => {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const entryPath = path.join(current, entry.name)
			if (entry.isSymbolicLink()) throw new Error(`Package contains a forbidden symlink: ${entryPath}`)
			if (entry.isDirectory()) await collect(entryPath)
			else if (entry.isFile()) files.push(entryPath)
		}
	}
	await collect(directory)
	files.sort()
	const hash = createHash('sha256')
	for (const file of files) {
		hash.update(path.relative(directory, file).split(path.sep).join('/'))
		hash.update('\0')
		hash.update(
			createHash('sha256')
				.update(await readFile(file))
				.digest('hex'),
		)
		hash.update('\n')
	}
	return hash.digest('hex')
}

const dependencyGroups = (packageJson: PackageJson): Array<[string, Record<string, string> | undefined]> => [
	['dependencies', packageJson.dependencies],
	['devDependencies', packageJson.devDependencies],
	['optionalDependencies', packageJson.optionalDependencies],
	['peerDependencies', packageJson.peerDependencies],
]

export const assertNoLocalDependencySpecs = (packageJson: PackageJson, allowed: Readonly<Record<string, string>> = {}): void => {
	for (const [groupName, dependencies] of dependencyGroups(packageJson)) {
		for (const [name, specifier] of Object.entries(dependencies ?? {})) {
			if (allowed[name] === specifier) continue
			if (/^(?:file|link|portal|workspace):/i.test(specifier) || /^(?:\.{0,2}\/|\/|~\/)/.test(specifier)) {
				throw new Error(`Forbidden local dependency path in ${groupName}: ${name}=${specifier}`)
			}
		}
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

const dependencyMapNames = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const
const externalSourcePrefix = /^(?:https?|git(?:\+https|\+ssh|\+git)?|ssh|github|gitlab|bitbucket|npm):/i

const isLocalDependencySource = (source: string): boolean => {
	if (/^(?:file|link|portal|workspace):/i.test(source)) return true
	if (/^(?:\.{1,2}(?:[\\/]|$)|~[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(source)) return true
	if (source.split(/[\\/]+/).includes('..')) return true
	if (externalSourcePrefix.test(source) || /^git@[^:]+:/.test(source)) return false
	return source.includes('/') || source.includes('\\') || /\.tgz(?:$|[?#])/i.test(source)
}

const packageResolutionSource = (resolution: string): string => {
	if (resolution.startsWith('@')) {
		const scopeSeparator = resolution.indexOf('/')
		if (scopeSeparator < 0) return resolution
		const sourceSeparator = resolution.indexOf('@', scopeSeparator + 1)
		return sourceSeparator < 0 ? resolution : resolution.slice(sourceSeparator + 1)
	}
	const sourceSeparator = resolution.indexOf('@')
	return sourceSeparator < 0 ? resolution : resolution.slice(sourceSeparator + 1)
}

const assertDependencyMaps = (value: Record<string, unknown>, location: string, allowed: Readonly<Record<string, string>> = {}): void => {
	for (const groupName of dependencyMapNames) {
		const dependencies = value[groupName]
		if (dependencies === undefined) continue
		if (!isRecord(dependencies)) throw new Error(`Malformed Bun lockfile ${location}.${groupName}`)
		for (const [name, source] of Object.entries(dependencies)) {
			if (typeof source !== 'string') throw new Error(`Malformed Bun lockfile dependency source at ${location}.${groupName}.${name}`)
			if (allowed[name] === source) continue
			if (isLocalDependencySource(source)) {
				throw new Error(`Forbidden local dependency source in Bun lockfile at ${location}.${groupName}: ${name}=${source}`)
			}
		}
	}
}

const assertPackageEntry = (packageKey: string, entry: unknown, sealedArchives: SealedBunLockArchives): void => {
	const location = `packages.${packageKey}`
	if (Array.isArray(entry)) {
		if (typeof entry[0] !== 'string') throw new Error(`Malformed Bun lockfile package resolution at ${location}[0]`)
		const resolution = entry[0]
		if (sealedArchives[packageKey]?.packageResolution !== resolution && isLocalDependencySource(packageResolutionSource(resolution))) {
			throw new Error(`Forbidden local package resolution in Bun lockfile at ${location}[0]: ${resolution}`)
		}
		if (typeof entry[1] === 'string' && entry[1] !== '' && isLocalDependencySource(entry[1])) {
			throw new Error(`Forbidden local package source in Bun lockfile at ${location}[1]: ${entry[1]}`)
		}
		for (const [index, value] of entry.entries()) {
			if (isRecord(value)) assertDependencyMaps(value, `${location}[${index}]`)
		}
		return
	}

	if (!isRecord(entry)) throw new Error(`Malformed Bun lockfile package entry at ${location}`)
	for (const field of ['resolution', 'resolved', 'source'] as const) {
		const source = entry[field]
		if (source === undefined) continue
		if (typeof source !== 'string') throw new Error(`Malformed Bun lockfile package ${field} at ${location}.${field}`)
		const allowedResolution = field === 'resolution' && sealedArchives[packageKey]?.packageResolution === source
		const candidate = field === 'resolution' ? packageResolutionSource(source) : source
		if (!allowedResolution && isLocalDependencySource(candidate)) {
			throw new Error(`Forbidden local package ${field} in Bun lockfile at ${location}.${field}: ${source}`)
		}
	}
	assertDependencyMaps(entry, location)
	for (const [field, value] of Object.entries(entry)) {
		if (isRecord(value)) assertDependencyMaps(value, `${location}.${field}`)
	}
}

export const assertNoLocalDependencySourcesInBunLock = (lockText: string, sealedArchives: SealedBunLockArchives = {}): void => {
	let parsed: unknown
	try {
		parsed = Bun.JSONC.parse(lockText)
	} catch {
		throw new Error('Bun lockfile is not valid JSONC')
	}
	if (!isRecord(parsed)) throw new Error('Bun lockfile root must be an object')
	if (!isRecord(parsed.workspaces)) throw new Error('Bun lockfile workspaces must be an object')
	if (!isRecord(parsed.packages)) throw new Error('Bun lockfile packages must be an object')

	for (const [workspaceName, workspace] of Object.entries(parsed.workspaces)) {
		if (!isRecord(workspace)) throw new Error(`Malformed Bun lockfile workspace: ${workspaceName}`)
		const allowed =
			workspaceName === ''
				? Object.fromEntries(Object.entries(sealedArchives).map(([name, archive]) => [name, archive.workspaceSpecifier]))
				: {}
		assertDependencyMaps(workspace, `workspaces.${workspaceName || '<root>'}`, allowed)
	}
	for (const [packageKey, entry] of Object.entries(parsed.packages)) assertPackageEntry(packageKey, entry, sealedArchives)
}

export const forbiddenPackage = (packageJson: PackageJson): string | undefined => {
	const name = packageJson.name ?? ''
	const version = packageJson.version ?? ''
	if (name === 'coco-cashu-core' || name === 'coco-cashu-indexeddb') return `${name}@${version || 'unknown'}`
	if (/(^|[/@_-])(cocod|npc|npubcash)($|[/@_-])/i.test(name)) return `${name}@${version || 'unknown'}`
	if (name === CASHU_TS_PACKAGE && ['2.9.0', '3.7.1'].includes(version)) return `${name}@${version}`
	if (/rc11/i.test(version) && /coco/i.test(name)) return `${name}@${version}`
	return undefined
}

const collectPackageOccurrences = async (nodeModules: string): Promise<Map<string, PackageOccurrence[]>> => {
	const occurrences = new Map<string, PackageOccurrence[]>()
	const visitedDirectories = new Set<string>()
	const visit = async (directory: string): Promise<void> => {
		const physicalDirectory = await realpath(directory)
		if (visitedDirectories.has(physicalDirectory)) return
		visitedDirectories.add(physicalDirectory)

		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name)
			if (entry.isSymbolicLink()) {
				try {
					const packageJson = JSON.parse(await readFile(path.join(entryPath, 'package.json'), 'utf8')) as PackageJson
					if (packageJson.name) {
						const resolved = await realpath(entryPath)
						const current = occurrences.get(packageJson.name) ?? []
						current.push({ packageJson, physicalDirectory: resolved, physicalPath: path.relative(nodeModules, resolved), symlinked: true })
						occurrences.set(packageJson.name, current)
					}
				} catch {
					// Non-package symlinks such as node_modules/.bin are outside this package-identity gate.
				}
				continue
			}
			if (!entry.isDirectory()) continue

			try {
				const packageJson = JSON.parse(await readFile(path.join(entryPath, 'package.json'), 'utf8')) as PackageJson
				if (packageJson.name) {
					const resolved = await realpath(entryPath)
					const current = occurrences.get(packageJson.name) ?? []
					current.push({
						packageJson,
						physicalDirectory: resolved,
						physicalPath: path.relative(nodeModules, resolved),
						symlinked: false,
					})
					occurrences.set(packageJson.name, current)
				}
			} catch {
				// Scope directories and Bun's internal store do not have package.json files.
			}
			await visit(entryPath)
		}
	}
	await visit(nodeModules)
	return occurrences
}

const onePhysicalPackage = (occurrences: Map<string, PackageOccurrence[]>, name: string): PackageOccurrence => {
	const matches = occurrences.get(name) ?? []
	const physical = new Map(matches.map((match) => [match.physicalDirectory, match]))
	if (physical.size !== 1) throw new Error(`Expected exactly one physical ${name} artifact, found ${physical.size}`)
	if (matches.some((match) => match.symlinked)) throw new Error(`Forbidden symlinked ${name} artifact`)
	const match = physical.values().next().value
	if (!match) throw new Error(`Missing physical ${name} artifact`)
	return match
}

const assertNoSourceMaps = async (directory: string): Promise<void> => {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name)
		if (entry.isSymbolicLink()) continue
		if (entry.isDirectory()) await assertNoSourceMaps(entryPath)
		else if (entry.isFile() && entry.name.endsWith('.map')) throw new Error(`Source map forbidden in release: ${entryPath}`)
	}
}

const assertNoSymlinks = async (directory: string): Promise<void> => {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name)
		if (entry.isSymbolicLink()) throw new Error(`Symlink forbidden in release: ${entryPath}`)
		if (entry.isDirectory()) await assertNoSymlinks(entryPath)
	}
}

const main = async (): Promise<void> => {
	const root = path.resolve(readArg('--root') ?? process.cwd())
	const marketGitSha = requiredArg('--market-sha')
	const marketGitTree = requiredArg('--market-tree')
	const coreGitSha = requiredArg('--core-git-sha')
	const expectedCoreSha256 = requiredArg('--core-sha256')
	const expectedIndexedDbSha256 = requiredArg('--indexeddb-sha256')
	const freshTestPath = path.resolve(requiredArg('--fresh-test'))
	const freshPublicReportPath = path.resolve(requiredArg('--fresh-public-report'))
	const expectedFreshTestSha256 = requiredArg('--fresh-test-sha256')
	const smokeResultPath = path.resolve(requiredArg('--smoke-result'))
	const expectedSmokeResultSha256 = requiredArg('--smoke-result-sha256')
	const writeManifestPath = readArg('--write-manifest')

	if (!/^[0-9a-f]{40}$/.test(marketGitSha)) throw new Error('market SHA must be 40 lowercase hexadecimal characters')
	if (!/^[0-9a-f]{40}$/.test(marketGitTree)) throw new Error('market tree must be 40 lowercase hexadecimal characters')
	if (!/^[0-9a-f]{40}$/.test(coreGitSha)) throw new Error('Core Git SHA must be 40 lowercase hexadecimal characters')
	assertSha256('Core SHA-256', expectedCoreSha256)
	assertSha256('IndexedDB SHA-256', expectedIndexedDbSha256)
	assertSha256('FRESH_AUCTIONSDEV_TEST SHA-256', expectedFreshTestSha256)
	assertSha256('COCO_AUCTIONSDEV_SMOKE_RESULT SHA-256', expectedSmokeResultSha256)
	if (Bun.version !== BUN_VERSION) throw new Error(`Expected Bun ${BUN_VERSION}, got ${Bun.version}`)
	if (process.env.NODE_PATH) throw new Error('NODE_PATH is forbidden for AuctionsDev releases')

	if (coreGitSha !== COCO_CORE_SHA) throw new Error('Core Git SHA does not match the sealed artifact contract')
	if (expectedCoreSha256 !== COCO_CORE_INSTALLED_CONTENT_HASH.slice('sha256:'.length)) {
		throw new Error('Core installed-content SHA-256 does not match the sealed artifact contract')
	}
	if (expectedIndexedDbSha256 !== COCO_INDEXEDDB_INSTALLED_CONTENT_HASH.slice('sha256:'.length)) {
		throw new Error('IndexedDB installed-content SHA-256 does not match the sealed artifact contract')
	}

	const coreArchiveRelative = path.posix.join(COCO_VENDOR_DIRECTORY, 'cashu-coco-core-2.0.0.tgz')
	const indexedDbArchiveRelative = path.posix.join(COCO_VENDOR_DIRECTORY, 'cashu-coco-indexeddb-2.0.0.tgz')
	const exactCoreSpecifier = `file:${coreArchiveRelative}`
	const exactIndexedDbSpecifier = `file:${indexedDbArchiveRelative}`
	const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as PackageJson
	assertNoLocalDependencySpecs(rootPackage, {
		[CORE_PACKAGE]: exactCoreSpecifier,
		[INDEXED_DB_PACKAGE]: exactIndexedDbSpecifier,
	})
	if (rootPackage.dependencies?.[CORE_PACKAGE] !== exactCoreSpecifier) throw new Error('Market Core archive pin is not exact')
	if (rootPackage.dependencies?.[INDEXED_DB_PACKAGE] !== exactIndexedDbSpecifier)
		throw new Error('Market IndexedDB archive pin is not exact')
	const lockText = await readFile(path.join(root, 'bun.lock'), 'utf8')
	assertNoLocalDependencySourcesInBunLock(lockText, {
		[CORE_PACKAGE]: {
			workspaceSpecifier: exactCoreSpecifier,
			packageResolution: `${CORE_PACKAGE}@${coreArchiveRelative}`,
		},
		[INDEXED_DB_PACKAGE]: {
			workspaceSpecifier: exactIndexedDbSpecifier,
			packageResolution: `${INDEXED_DB_PACKAGE}@${indexedDbArchiveRelative}`,
		},
	})
	if (/NODE_PATH/.test(await readFile(path.join(root, 'deploy-simple/auctionsdev/ecosystem.config.cjs'), 'utf8'))) {
		throw new Error('NODE_PATH is forbidden in the PM2 deployment configuration')
	}
	await assertNoSymlinks(root)
	await assertNoSourceMaps(root)
	const [coreArchiveSha256, indexedDbArchiveSha256] = await Promise.all([
		hashFile(path.join(root, coreArchiveRelative)),
		hashFile(path.join(root, indexedDbArchiveRelative)),
	])
	if (coreArchiveSha256 !== COCO_CORE_ARCHIVE_SHA256) throw new Error('Sealed Coco Core archive digest mismatch')
	if (indexedDbArchiveSha256 !== COCO_INDEXEDDB_ARCHIVE_SHA256) throw new Error('Sealed Coco IndexedDB archive digest mismatch')

	const freshTestSha256 = await hashFile(freshTestPath)
	if (freshTestSha256 !== expectedFreshTestSha256) throw new Error('FRESH_AUCTIONSDEV_TEST artifact digest mismatch')
	const freshEvidence = validateBoundFreshWalletPreflightEvidence(JSON.parse(await readFile(freshTestPath, 'utf8')) as unknown, {
		marketGitSha,
		coreGitSha,
		coreSha256: expectedCoreSha256,
		indexedDbSha256: expectedIndexedDbSha256,
	})
	if ((await hashFile(freshPublicReportPath)) !== freshEvidence.rawPublicReportSha256) {
		throw new Error('Fresh-wallet public report digest does not match bound evidence')
	}
	const smokeResultSha256 = await hashFile(smokeResultPath)
	if (smokeResultSha256 !== expectedSmokeResultSha256) throw new Error('COCO_AUCTIONSDEV_SMOKE_RESULT artifact digest mismatch')
	const smokeResult = validateBoundAuctionsdevSmokeEvidence(JSON.parse(await readFile(smokeResultPath, 'utf8')) as unknown, {
		marketGitSha,
		coreGitSha,
		coreSha256: expectedCoreSha256,
		indexedDbSha256: expectedIndexedDbSha256,
	})

	const architecture = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : undefined
	if (!architecture) throw new Error(`Unsupported packaged runtime architecture: ${process.arch}`)
	const fakeMintDigest = await hashFile(path.join(root, 'runtime/cdk-mintd'))
	if (fakeMintDigest !== FAKE_MINT_SHA256[architecture]) throw new Error(`Pinned cdk-mintd digest mismatch for ${architecture}`)

	const occurrences = await collectPackageOccurrences(path.join(root, 'node_modules'))
	occurrences.forEach((matches) => {
		for (const occurrence of matches) {
			const forbidden = forbiddenPackage(occurrence.packageJson)
			if (forbidden) throw new Error(`Forbidden obsolete/private Cashu package in release: ${forbidden}`)
		}
	})

	const coreOccurrence = onePhysicalPackage(occurrences, CORE_PACKAGE)
	const indexedDbOccurrence = onePhysicalPackage(occurrences, INDEXED_DB_PACKAGE)
	const cashuOccurrence = onePhysicalPackage(occurrences, CASHU_TS_PACKAGE)
	const core = coreOccurrence.packageJson
	const indexedDb = indexedDbOccurrence.packageJson
	const cashuTs = cashuOccurrence.packageJson
	if (!core.version || !indexedDb.version || cashuTs.version !== CASHU_TS_VERSION) {
		throw new Error(`Expected current Coco packages and ${CASHU_TS_PACKAGE}@${CASHU_TS_VERSION}`)
	}
	if (rootPackage.dependencies?.[CASHU_TS_PACKAGE] !== CASHU_TS_VERSION) throw new Error(`Market must pin ${CASHU_TS_PACKAGE} exactly`)
	if (core.dependencies?.[CASHU_TS_PACKAGE] !== CASHU_TS_VERSION) throw new Error(`Coco Core must pin ${CASHU_TS_PACKAGE} exactly`)

	const [coreSha256, indexedDbSha256, cashuTsSha256] = await Promise.all([
		hashPackageDirectory(coreOccurrence.physicalDirectory),
		hashPackageDirectory(indexedDbOccurrence.physicalDirectory),
		hashPackageDirectory(cashuOccurrence.physicalDirectory),
	])
	if (coreSha256 !== expectedCoreSha256) throw new Error(`Coco Core artifact digest mismatch: got ${coreSha256}`)
	if (indexedDbSha256 !== expectedIndexedDbSha256) throw new Error(`Coco IndexedDB artifact digest mismatch: got ${indexedDbSha256}`)

	const packageIdentity = (occurrence: PackageOccurrence, sha256: string): PackageIdentity => ({
		name: occurrence.packageJson.name ?? '',
		version: occurrence.packageJson.version ?? '',
		sha256,
		physicalPath: path.join('node_modules', occurrence.physicalPath),
		symlinked: false,
	})
	const coreIdentity = packageIdentity(coreOccurrence, coreSha256)
	const indexedDbIdentity = packageIdentity(indexedDbOccurrence, indexedDbSha256)
	const cashuIdentity = packageIdentity(cashuOccurrence, cashuTsSha256) as PackageIdentity & { version: typeof CASHU_TS_VERSION }
	const cocoPackageIdentity = [coreIdentity, indexedDbIdentity, cashuIdentity]
		.map((identity) => `${identity.name}@${identity.version}#sha256:${identity.sha256}`)
		.join(';')

	const manifest: DeploymentManifest = {
		schemaVersion: 4,
		marketGitSha,
		marketGitTree,
		coreGitSha,
		archives: {
			cocoCore: { path: coreArchiveRelative, sha256: coreArchiveSha256 },
			cocoIndexedDb: { path: indexedDbArchiveRelative, sha256: indexedDbArchiveSha256 },
		},
		cocoPackageIdentity,
		packages: { cocoCore: coreIdentity, cocoIndexedDb: indexedDbIdentity, cashuTs: cashuIdentity },
		dependencyTree: [
			{
				consumer: rootPackage.name ?? 'root',
				requirement: rootPackage.dependencies?.[CASHU_TS_PACKAGE] ?? '',
				resolvedName: CASHU_TS_PACKAGE,
				resolvedVersion: CASHU_TS_VERSION,
				physicalPath: cashuIdentity.physicalPath,
			},
			{
				consumer: core.name ?? CORE_PACKAGE,
				requirement: core.dependencies?.[CASHU_TS_PACKAGE] ?? '',
				resolvedName: CASHU_TS_PACKAGE,
				resolvedVersion: CASHU_TS_VERSION,
				physicalPath: cashuIdentity.physicalPath,
			},
		],
		physicalCopies: { cocoCore: 1, cocoIndexedDb: 1, cashuTs: 1 },
		bunVersion: BUN_VERSION,
		bunLockSha256: createHash('sha256').update(lockText).digest('hex'),
		fakeMint: { name: 'cdk-mintd', version: FAKE_MINT_VERSION, sha256: FAKE_MINT_SHA256 },
		freshAuctionsdevTest: { ...freshEvidence, sha256: freshTestSha256 },
		cocoAuctionsdevSmoke: { ...smokeResult, sha256: smokeResultSha256 },
		environment: 'auctionsdev',
		monetaryMode: 'coco-test',
		mintMode: 'fake',
		realFundsEnabled: false,
	}

	if (writeManifestPath) {
		await writeFile(path.resolve(writeManifestPath), `${JSON.stringify(manifest, null, 2)}\n`)
	} else {
		const existing = JSON.parse(await readFile(path.join(root, 'deployment-manifest.json'), 'utf8')) as DeploymentManifest
		if (JSON.stringify(existing) !== JSON.stringify(manifest)) throw new Error('Deployment manifest does not match packaged runtime')
	}
	console.log(JSON.stringify(manifest))
}

if (import.meta.main) void main()
