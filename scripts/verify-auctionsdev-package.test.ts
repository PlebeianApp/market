import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertNoLocalDependencySpecs, forbiddenPackage, hashPackageDirectory } from './verify-auctionsdev-package'

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
