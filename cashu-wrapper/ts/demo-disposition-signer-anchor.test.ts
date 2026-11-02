import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { demoDispositionEnrollmentPermit, openDemoDispositionSignerAnchor } from './demo-disposition-signer-anchor'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function writePermit(path: string, options: {
	participantId: 1 | 2 | 3 | 4; dkgRunId: string; publicKeyPackageSha256: string; signerRosterDigest: string
}): Promise<void> {
	await writeFile(path, JSON.stringify(demoDispositionEnrollmentPermit(options)), { mode: 0o600, flag: 'wx' })
}

describe('disposition signer rollback anchor', () => {
	test('advances normally and rejects a stale signer metadata restore', async () => {
		const root = await mkdtemp('/tmp/coco-disposition-anchor-'); roots.push(root)
		const stateDirectory = join(root, 'signer-state'); await mkdir(stateDirectory)
		await writeFile(join(stateDirectory, 'dkg-final.state'), '{"test":"dkg-share-v1"}', { mode: 0o600 })
		const signerMetadataPath = join(stateDirectory, 'disposition-metadata.sqlite3')
		const proofUsePath = join(root, 'proof-use.sqlite3')
		const coordinatorAnchorPath = join(root, 'independent-anchor.sqlite3')
		const initialEnrollmentPermitPath = join(root, 'enrollment-permit.json')
		const options = {
			participantId: 1 as const, dkgRunId: 'dkg-1', publicKeyPackageSha256: '11'.repeat(32),
			signerRosterDigest: '22'.repeat(32), stateDirectory, signerMetadataPath, proofUsePath, coordinatorAnchorPath,
			initialEnrollmentPermitPath,
		}
		await writePermit(initialEnrollmentPermitPath, options)
		const first = openDemoDispositionSignerAnchor(options)
		expect(first.binding.restartEpoch).toBe(1); first.close()
		const stale = join(root, 'stale.sqlite3'); await copyFile(signerMetadataPath, stale)
		const second = openDemoDispositionSignerAnchor(options)
		expect(second.binding.restartEpoch).toBe(2); second.close()
		await copyFile(stale, signerMetadataPath)
		expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/regressed or was reused/)
	})

	test('rejects a partial stale restore of an actual Rust nonce journal', async () => {
		const root = await mkdtemp('/tmp/coco-disposition-rust-anchor-'); roots.push(root)
		const stateDirectory = join(root, 'signer-state'); await mkdir(stateDirectory)
		await writeFile(join(stateDirectory, 'dkg-final.state'), '{"test":"dkg-share-v1"}', { mode: 0o600 })
		const options = {
			participantId: 1 as const, dkgRunId: 'dkg-1', publicKeyPackageSha256: '11'.repeat(32),
			signerRosterDigest: '22'.repeat(32), stateDirectory,
			signerMetadataPath: join(stateDirectory, 'disposition-metadata.sqlite3'),
			proofUsePath: join(root, 'proof-use.sqlite3'), coordinatorAnchorPath: join(root, 'independent-anchor.sqlite3'),
			initialEnrollmentPermitPath: join(root, 'enrollment-permit.json'),
		}
		await writePermit(options.initialEnrollmentPermitPath, options)
		const journal = join(stateDirectory, `sign-${'33'.repeat(32)}.journal`)
		const first = openDemoDispositionSignerAnchor(options)
		await writeFile(journal, '{"state":"committed"}', { mode: 0o600 }); first.recordRustStateAdvance(); first.close()
		const stale = join(root, 'stale-sign.journal'); await copyFile(journal, stale)
		const second = openDemoDispositionSignerAnchor(options)
		await writeFile(journal, '{"state":"consumed"}', { mode: 0o600 }); second.recordRustStateAdvance(); second.close()
		await copyFile(stale, journal)
		expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/Rust nonce\/operation journal was restored or replaced/)
	})

	test('rejects a partial stale restore of the proof-use database', async () => {
		const root = await mkdtemp('/tmp/coco-disposition-proof-anchor-'); roots.push(root)
		const stateDirectory = join(root, 'signer-state'); await mkdir(stateDirectory)
		await writeFile(join(stateDirectory, 'dkg-final.state'), '{"test":"dkg-share-v1"}', { mode: 0o600 })
		const proofUsePath = join(root, 'proof-use.sqlite3')
		const options = {
			participantId: 1 as const, dkgRunId: 'dkg-1', publicKeyPackageSha256: '11'.repeat(32),
			signerRosterDigest: '22'.repeat(32), stateDirectory,
			signerMetadataPath: join(stateDirectory, 'disposition-metadata.sqlite3'), proofUsePath,
			coordinatorAnchorPath: join(root, 'independent-anchor.sqlite3'),
			initialEnrollmentPermitPath: join(root, 'enrollment-permit.json'),
		}
		await writePermit(options.initialEnrollmentPermitPath, options)
		const claim = (proofRef: string) => ({
			proofRef, network: 'local', chainId: 'chain', auctionId: 'auction',
			operationId: 'operation', policyDigest: '44'.repeat(32),
		})
		const first = openDemoDispositionSignerAnchor(options)
		first.claimProofs([claim(`02${'55'.repeat(32)}`)]); first.close()
		const stale = join(root, 'stale-proof-use.sqlite3'); await copyFile(proofUsePath, stale)
		const second = openDemoDispositionSignerAnchor(options)
		second.claimProofs([claim(`03${'66'.repeat(32)}`)]); second.close()
		await copyFile(stale, proofUsePath)
		expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/proof-use store was restored or replaced/)
	})

	test('rejects a partial stale restore of the admission RPC/proof safety database', async () => {
		const root = await mkdtemp('/tmp/coco-disposition-admission-anchor-'); roots.push(root)
		const stateDirectory = join(root, 'signer-state'); await mkdir(stateDirectory)
		await writeFile(join(stateDirectory, 'dkg-final.state'), '{"test":"dkg-share-v1"}', { mode: 0o600 })
		const admissionSafetyPath = join(root, 'admission-safety.sqlite3')
		const options = {
			participantId: 1 as const, dkgRunId: 'dkg-1', publicKeyPackageSha256: '11'.repeat(32),
			signerRosterDigest: '22'.repeat(32), stateDirectory,
			signerMetadataPath: join(stateDirectory, 'disposition-metadata.sqlite3'),
			proofUsePath: join(root, 'proof-use.sqlite3'), coordinatorAnchorPath: join(root, 'independent-anchor.sqlite3'),
			initialEnrollmentPermitPath: join(root, 'enrollment-permit.json'), admissionSafetyPath,
		}
		await writePermit(options.initialEnrollmentPermitPath, options)
		const claim = (proofRef: string) => ({
			proofRef, network: 'local', chainId: 'chain', auctionId: 'auction', operationId: 'operation',
		})
		const first = openDemoDispositionSignerAnchor(options)
		first.claimAdmissionProofs([claim(`02${'55'.repeat(32)}`)]); first.close()
		const stale = join(root, 'stale-admission.sqlite3'); await copyFile(admissionSafetyPath, stale)
		const second = openDemoDispositionSignerAnchor(options)
		second.claimAdmissionProofs([claim(`03${'66'.repeat(32)}`)]); second.close()
		await copyFile(stale, admissionSafetyPath)
		expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/admission RPC\/proof state was restored or replaced/)
	})

	test('never treats a missing established independent anchor as first enrollment', async () => {
		const root = await mkdtemp('/tmp/coco-disposition-missing-anchor-'); roots.push(root)
		const stateDirectory = join(root, 'signer-state'); await mkdir(stateDirectory)
		await writeFile(join(stateDirectory, 'dkg-final.state'), '{"test":"dkg-share-v1"}', { mode: 0o600 })
		const coordinatorAnchorPath = join(root, 'independent-anchor.sqlite3')
		const options = {
			participantId: 1 as const, dkgRunId: 'dkg-1', publicKeyPackageSha256: '11'.repeat(32),
			signerRosterDigest: '22'.repeat(32), stateDirectory,
			signerMetadataPath: join(stateDirectory, 'disposition-metadata.sqlite3'),
			proofUsePath: join(root, 'proof-use.sqlite3'), coordinatorAnchorPath,
			initialEnrollmentPermitPath: join(root, 'enrollment-permit.json'),
		}
		await writePermit(options.initialEnrollmentPermitPath, options)
		const enrolled = openDemoDispositionSignerAnchor(options); enrolled.close()
		await rm(coordinatorAnchorPath)
		expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/independent anchor is missing after signer initialization/)
		await writePermit(options.initialEnrollmentPermitPath, options)
		expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/independent anchor is missing after signer initialization/)
	})
})

// Synthetic journal bytes only; these tests never invoke Rust or read host shares.
async function admissionAnchorFixture() {
	const root = await mkdtemp('/tmp/coco-admission-rust-anchor-'); roots.push(root)
	const stateDirectory = join(root, 'signer-state'); await mkdir(stateDirectory)
	await writeFile(join(stateDirectory, 'dkg-final.state'), '{"synthetic":"dkg"}', { mode: 0o600 })
	const options = {
		participantId: 1 as const, dkgRunId: 'synthetic-dkg', publicKeyPackageSha256: '11'.repeat(32),
		signerRosterDigest: '22'.repeat(32), stateDirectory,
		signerMetadataPath: join(stateDirectory, 'metadata.sqlite3'), proofUsePath: join(root, 'proof.sqlite3'),
		coordinatorAnchorPath: join(root, 'anchor.sqlite3'), initialEnrollmentPermitPath: join(root, 'permit.json'),
	}
	await writePermit(options.initialEnrollmentPermitPath, options)
	return { root, options }
}

function rustRevision(path: string): number {
	const db = new Database(path, { readonly: true })
	try { return db.query<{ rust_state_revision: number }, []>(
		'SELECT rust_state_revision FROM disposition_signer_safety_anchor WHERE participant_id=1',
	).get()!.rust_state_revision } finally { db.close() }
}

const admissionPaths = [
	`admission-operations/${'44'.repeat(32)}.json`,
	'admission-durable-binding.json',
	`admission-sign-${'55'.repeat(32)}.journal`,
]

describe('admission Rust state independent anchoring', () => {
	for (const relative of admissionPaths) {
		test(`${relative}: commit/share advance; exact retry does not; partial restore blocks before Rust in-process and after restart`, async () => {
			const { options } = await admissionAnchorFixture()
			const file = join(options.stateDirectory, relative)
			if (relative.includes('/')) await mkdir(join(options.stateDirectory, 'admission-operations'))
			const anchor = openDemoDispositionSignerAnchor(options)
			try {
				const start = rustRevision(options.coordinatorAnchorPath)
				await writeFile(file, '{"phase":"committed","transcript":null}', { mode: 0o600 })
				anchor.recordRustStateAdvance(); anchor.assertRustStateCurrent()
				expect(rustRevision(options.coordinatorAnchorPath)).toBe(start + 1)
				const old = await readFile(file)
				await writeFile(file, '{"phase":"consumed","transcript":"T1"}', { mode: 0o600 })
				anchor.recordRustStateAdvance(); anchor.assertRustStateCurrent()
				expect(rustRevision(options.coordinatorAnchorPath)).toBe(start + 2)
				anchor.recordRustStateAdvance()
				expect(rustRevision(options.coordinatorAnchorPath)).toBe(start + 2)
				await writeFile(file, old)
				let rustCalled = false
				expect(() => { anchor.assertRustStateCurrent(); rustCalled = true }).toThrow(/QUARANTINED/)
				expect(rustCalled).toBe(false)
			} finally { anchor.close() }
			expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/restored or replaced/)
		})

		for (const mutation of ['unanchored-write', 'delete'] as const) {
			test(`${relative}: ${mutation} crash boundary quarantines live and restarted signer`, async () => {
				const { options } = await admissionAnchorFixture()
				const file = join(options.stateDirectory, relative)
				if (relative.includes('/')) await mkdir(join(options.stateDirectory, 'admission-operations'))
				const anchor = openDemoDispositionSignerAnchor(options)
				try {
					await writeFile(file, '{"synthetic":"committed"}', { mode: 0o600 })
					anchor.recordRustStateAdvance()
					if (mutation === 'delete') await rm(file)
					else await writeFile(file, '{"synthetic":"consuming-T1"}', { mode: 0o600 })
					// Simulate failure after Rust persisted state but before successful anchor update.
					expect(() => anchor.assertRustStateCurrent()).toThrow(/QUARANTINED/)
				} finally { anchor.close() }
				expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/restored or replaced/)
			})
		}
	}

	for (const relative of [
		'admission-operations/unexpected.json', 'admission-operations/nested',
		'admission-sign', 'admission-sign-wrong.journal', 'admission-sign-' + '66'.repeat(32) + '.journal.extra',
		'admission-durable-binding.json.old', 'admission-operations.old',
	]) {
		test(`rejects unexpected safety entry ${relative}`, async () => {
			const { options } = await admissionAnchorFixture()
			const anchor = openDemoDispositionSignerAnchor(options)
			try {
				if (relative.includes('/')) await mkdir(join(options.stateDirectory, 'admission-operations'))
				await writeFile(join(options.stateDirectory, relative), '{}')
				expect(() => anchor.assertRustStateCurrent()).toThrow()
				expect(() => anchor.recordRustStateAdvance()).toThrow()
			} finally { anchor.close() }
			expect(() => openDemoDispositionSignerAnchor(options)).toThrow()
		})
	}

	for (const relative of ['admission-operations', ...admissionPaths]) {
		test(`rejects dangling symlink ${relative}`, async () => {
			const { options } = await admissionAnchorFixture()
			const anchor = openDemoDispositionSignerAnchor(options)
			try {
				if (relative.includes('/')) await mkdir(join(options.stateDirectory, 'admission-operations'))
				await symlink(join(options.stateDirectory, 'absent'), join(options.stateDirectory, relative))
				expect(() => anchor.assertRustStateCurrent()).toThrow()
				expect(() => anchor.recordRustStateAdvance()).toThrow()
			} finally { anchor.close() }
			expect(() => openDemoDispositionSignerAnchor(options)).toThrow()
		})
	}
})


describe('strict safety digest boundaries', () => {
	for (const relative of [
		`operations/${'66'.repeat(32)}.json`, `sign-${'77'.repeat(32)}.journal`,
		`funding-abort-operations/${'88'.repeat(32)}.json`, 'funding-abort-durable-binding.json',
		`funding-abort-sign-${'99'.repeat(32)}.journal`,
	]) {
		test(`retains prior signer-domain coverage: ${relative}`, async () => {
			const { options } = await admissionAnchorFixture()
			const anchor = openDemoDispositionSignerAnchor(options)
			try {
				if (relative.includes('/')) await mkdir(join(options.stateDirectory, relative.split('/')[0]!))
				const file = join(options.stateDirectory, relative)
				await writeFile(file, 'before'); anchor.recordRustStateAdvance()
				await writeFile(file, 'after!'); anchor.recordRustStateAdvance()
				await writeFile(file, 'before')
				expect(() => anchor.assertRustStateCurrent()).toThrow(/QUARANTINED/)
			} finally { anchor.close() }
			expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/restored or replaced/)
		})
	}

	for (const mutation of ['empty-directory', 'remove-directory', 'older-directory', 'truncate', 'same-size-byte', 'json-key-order'] as const) {
		test(`detects ${mutation} without treating established state as absent`, async () => {
			const { options } = await admissionAnchorFixture()
			const directory = join(options.stateDirectory, 'admission-operations')
			await mkdir(directory)
			const first = join(directory, `${'11'.repeat(32)}.json`)
			const second = join(directory, `${'22'.repeat(32)}.json`)
			const journal = join(options.stateDirectory, `admission-sign-${'33'.repeat(32)}.journal`)
			await writeFile(first, '{"a":1,"b":2}'); await writeFile(second, '{}')
			await writeFile(journal, '{"a":1,"b":2}')
			const anchor = openDemoDispositionSignerAnchor(options)
			try {
				if (mutation === 'remove-directory') await rm(directory, { recursive: true })
				else if (mutation === 'empty-directory') { await rm(first); await rm(second) }
				else if (mutation === 'older-directory') await rm(second)
				else if (mutation === 'truncate') await writeFile(journal, '')
				else if (mutation === 'same-size-byte') await writeFile(journal, '{"a":1,"b":3}')
				else await writeFile(journal, '{"b":2,"a":1}')
				expect(() => anchor.assertRustStateCurrent()).toThrow(/QUARANTINED/)
			} finally { anchor.close() }
			expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/restored or replaced/)
		})
	}

	for (const relative of admissionPaths) {
		test(`rejects directory in place of safety file: ${relative}`, async () => {
			const { options } = await admissionAnchorFixture()
			if (relative.includes('/')) await mkdir(join(options.stateDirectory, 'admission-operations'))
			await mkdir(join(options.stateDirectory, relative))
			expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/regular file/)
		})
	}

	test('creation order is irrelevant, unchanged state reopens, external byte order changes do not', async () => {
		const digests: string[] = []
		for (const paths of [admissionPaths, [...admissionPaths].reverse()]) {
			const { options } = await admissionAnchorFixture()
			await mkdir(join(options.stateDirectory, 'admission-operations'))
			for (const relative of paths) await writeFile(join(options.stateDirectory, relative), '{"synthetic":"same"}')
			const anchor = openDemoDispositionSignerAnchor(options)
			anchor.assertRustStateCurrent(); anchor.close()
			const reopened = openDemoDispositionSignerAnchor(options)
			try { reopened.assertRustStateCurrent() } finally { reopened.close() }
			const db = new Database(options.coordinatorAnchorPath, { readonly: true })
			try { digests.push(db.query<{ rust_state_digest: string }, []>(
				'SELECT rust_state_digest FROM disposition_signer_safety_anchor WHERE participant_id=1',
			).get()!.rust_state_digest) } finally { db.close() }
		}
		expect(digests[0]).toBe(digests[1])
	})
})


test('legacy anchor with formerly omitted admission state quarantines; no automatic digest migration', async () => {
	const { options } = await admissionAnchorFixture()
	await writeFile(join(options.stateDirectory, `admission-sign-${'ab'.repeat(32)}.journal`), '{"synthetic":"consumed"}')
	const anchor = openDemoDispositionSignerAnchor(options); anchor.close()
	// This is the exact old V1 digest when the only covered file was dkg-final.state.
	const oldDigest = new Bun.CryptoHasher('sha256').update(JSON.stringify([
		'COCO_DEMO_RUST_SIGNER_SAFETY_STATE_V1', [{ name: 'dkg-final.state',
			digest: new Bun.CryptoHasher('sha256').update('{"synthetic":"dkg"}').digest('hex') }],
	])).digest('hex')
	const db = new Database(options.coordinatorAnchorPath)
	try { db.query('UPDATE disposition_signer_safety_anchor SET rust_state_digest=? WHERE participant_id=1').run(oldDigest) }
	finally { db.close() }
	expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/restored or replaced/)
})
