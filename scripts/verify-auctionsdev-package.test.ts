import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
	assertNoLocalDependencySourcesInBunLock,
	assertNoLocalDependencySpecs,
	forbiddenPackage,
	hashPackageDirectory,
	type SealedBunLockArchive,
} from './verify-auctionsdev-package'

const coreName = '@cashu/coco-core'
const indexedDbName = '@cashu/coco-indexeddb'
const coreSpecifier = 'file:vendor/sealed/cashu-coco-core-2.0.0.tgz'
const indexedDbSpecifier = 'file:vendor/sealed/cashu-coco-indexeddb-2.0.0.tgz'
const sealedArchives: Record<string, SealedBunLockArchive> = {
	[coreName]: { workspaceSpecifier: coreSpecifier, packageResolution: `${coreName}@${coreSpecifier.slice('file:'.length)}` },
	[indexedDbName]: {
		workspaceSpecifier: indexedDbSpecifier,
		packageResolution: `${indexedDbName}@${indexedDbSpecifier.slice('file:'.length)}`,
	},
}

const lock = (value: unknown): string => JSON.stringify(value)
const dependencyGroups = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const
interface WorkspaceFixture {
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	optionalDependencies?: Record<string, string>
	peerDependencies?: Record<string, string>
}

interface LockFixture {
	lockfileVersion: number
	workspaces: Record<string, WorkspaceFixture>
	patchedDependencies: Record<string, string>
	packages: Record<string, unknown>
}

const safeLock = (): LockFixture => ({
	lockfileVersion: 1,
	workspaces: {
		'': {
			dependencies: { [coreName]: coreSpecifier, [indexedDbName]: indexedDbSpecifier, react: '^19.0.0' },
		},
	},
	patchedDependencies: { 'rxjs@7.8.2': 'patches/rxjs@7.8.2.patch' },
	packages: {
		[coreName]: [sealedArchives[coreName].packageResolution, { dependencies: { react: '^19.0.0' } }, 'sha512-core'],
		[indexedDbName]: [sealedArchives[indexedDbName].packageResolution, { peerDependencies: { react: '^19.0.0' } }, 'sha512-db'],
		react: ['react@19.0.0', '', { bin: './bin/react.js', scripts: { install: 'node ./bin/install.js' } }, 'sha512-react'],
	},
})

describe('hashPackageDirectory', () => {
	test('matches the UI installed-content hash algorithm', async () => {
		const fixture = await mkdtemp(path.join(tmpdir(), 'auctionsdev-package-contract-'))
		await mkdir(path.join(fixture, 'sub'))
		await writeFile(path.join(fixture, 'a.txt'), 'hello')
		await writeFile(path.join(fixture, 'sub/b.txt'), 'world')
		expect(await hashPackageDirectory(fixture)).toBe('103e6ff7b3cb37b7ae0377733082de32603da8f1dba12d4374c67e7787359c61')
	})

	test('is stable across file creation order', async () => {
		const first = await mkdtemp(path.join(tmpdir(), 'auctionsdev-package-a-'))
		const second = await mkdtemp(path.join(tmpdir(), 'auctionsdev-package-b-'))
		await mkdir(path.join(first, 'dist'))
		await mkdir(path.join(second, 'dist'))
		await writeFile(path.join(first, 'package.json'), '{"name":"fixture"}\n')
		await writeFile(path.join(first, 'dist/index.js'), 'export {}\n')
		await writeFile(path.join(second, 'dist/index.js'), 'export {}\n')
		await writeFile(path.join(second, 'package.json'), '{"name":"fixture"}\n')
		expect(await hashPackageDirectory(first)).toBe(await hashPackageDirectory(second))
	})
})

describe('dependency exclusions', () => {
	test('rejects every local dependency protocol', () => {
		for (const specifier of ['file:vendor/core.tgz', 'link:../core', 'portal:../core', 'workspace:*', '../core', '/tmp/core']) {
			expect(() => assertNoLocalDependencySpecs({ dependencies: { '@cashu/coco-core': specifier } })).toThrow(
				'Forbidden local dependency path',
			)
		}
	})

	test('accepts package bin metadata, tracked patch paths, and the exact sealed archive pins', () => {
		expect(() => assertNoLocalDependencySourcesInBunLock(lock(safeLock()), sealedArchives)).not.toThrow()
	})

	test('parses Bun JSONC without treating arbitrary path strings as dependency sources', () => {
		const jsonc = `{
			"workspaces": { "": { "dependencies": { "react": "19.0.0" } } },
			"patchedDependencies": { "rxjs@7.8.2": "patches/rxjs@7.8.2.patch" },
			"packages": { "react": ["react@19.0.0", "", { "bin": "./bin/react.js" }, ""] },
		}`
		expect(() => assertNoLocalDependencySourcesInBunLock(jsonc)).not.toThrow()
	})

	test('rejects local sources in the root workspace', () => {
		for (const source of [
			'file:vendor/evil.tgz',
			'link:../evil',
			'portal:../evil',
			'workspace:*',
			'./evil',
			'../evil',
			'..\\evil',
			'~/evil',
			'/tmp/evil',
			'C:\\evil',
		]) {
			const fixture = safeLock()
			fixture.workspaces[''].dependencies.evil = source
			expect(() => assertNoLocalDependencySourcesInBunLock(lock(fixture), sealedArchives)).toThrow('Forbidden local dependency source')
		}
	})

	test('rejects local sources in non-root workspaces', () => {
		const fixture = safeLock()
		fixture.workspaces['packages/child'] = { optionalDependencies: { evil: 'file:../../evil.tgz' } }
		expect(() => assertNoLocalDependencySourcesInBunLock(lock(fixture), sealedArchives)).toThrow('workspaces.packages/child')
	})

	test('inspects every dependency map in workspaces and package metadata', () => {
		for (const group of dependencyGroups) {
			const workspaceFixture = safeLock()
			workspaceFixture.workspaces[''][group] = { evil: '../evil' }
			expect(() => assertNoLocalDependencySourcesInBunLock(lock(workspaceFixture), sealedArchives)).toThrow(`workspaces.<root>.${group}`)

			const packageFixture = safeLock()
			packageFixture.packages.evil = ['evil@1.0.0', '', { [group]: { evil: '../evil' } }, '']
			expect(() => assertNoLocalDependencySourcesInBunLock(lock(packageFixture), sealedArchives)).toThrow(`packages.evil[2].${group}`)
		}
	})

	test('rejects local sources in transitive package dependency maps', () => {
		const fixture = safeLock()
		fixture.packages.react = ['react@19.0.0', '', { dependencies: { evil: '../evil' }, bin: './bin/react.js' }, '']
		expect(() => assertNoLocalDependencySourcesInBunLock(lock(fixture), sealedArchives)).toThrow('packages.react[2].dependencies')
	})

	test('rejects normalized local package resolution and source slots', () => {
		const resolutionFixture = safeLock()
		resolutionFixture.packages.evil = ['evil@vendor/evil.tgz', '', {}, '']
		expect(() => assertNoLocalDependencySourcesInBunLock(lock(resolutionFixture), sealedArchives)).toThrow('local package resolution')

		const sourceFixture = safeLock()
		sourceFixture.packages.evil = ['evil@1.0.0', '../evil', {}, '']
		expect(() => assertNoLocalDependencySourcesInBunLock(lock(sourceFixture), sealedArchives)).toThrow('local package source')
	})

	test('rejects near-matches for sealed workspace pins and normalized resolutions', () => {
		const workspaceNearMatch = safeLock()
		workspaceNearMatch.workspaces[''].dependencies[coreName] = `${coreSpecifier}.stale`
		expect(() => assertNoLocalDependencySourcesInBunLock(lock(workspaceNearMatch), sealedArchives)).toThrow(
			'Forbidden local dependency source',
		)

		const resolutionNearMatch = safeLock()
		resolutionNearMatch.packages[coreName] = [`${sealedArchives[coreName].packageResolution}.stale`, {}, '']
		expect(() => assertNoLocalDependencySourcesInBunLock(lock(resolutionNearMatch), sealedArchives)).toThrow('local package resolution')
	})

	test('allows only an explicitly sealed in-repository archive', () => {
		const specifier = 'file:vendor/coco-sealed/cashu-coco-core-2.0.0.tgz'
		expect(() =>
			assertNoLocalDependencySpecs({ dependencies: { '@cashu/coco-core': specifier } }, { '@cashu/coco-core': specifier }),
		).not.toThrow()
		expect(() =>
			assertNoLocalDependencySpecs(
				{ dependencies: { '@cashu/coco-core': 'file:vendor/coco-other/core.tgz' } },
				{ '@cashu/coco-core': specifier },
			),
		).toThrow('Forbidden local dependency path')
	})

	test('identifies obsolete and private Cashu graphs', () => {
		expect(forbiddenPackage({ name: 'coco-cashu-core', version: '1.0.0-rc11' })).toContain('coco-cashu-core')
		expect(forbiddenPackage({ name: '@cashu/cashu-ts', version: '2.9.0' })).toContain('2.9.0')
		expect(forbiddenPackage({ name: '@cashu/cashu-ts', version: '3.7.1' })).toContain('3.7.1')
		expect(forbiddenPackage({ name: '@npc/cocod', version: '1.0.0' })).toContain('cocod')
		expect(forbiddenPackage({ name: '@npubcash/wallet', version: '1.0.0' })).toContain('npubcash')
	})
})
