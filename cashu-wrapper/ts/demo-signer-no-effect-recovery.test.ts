import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { demoDispositionEnrollmentPermit, openDemoDispositionSignerAnchor } from './demo-disposition-signer-anchor'
import { recoverDemoSignerPendingBeforeEffect, type DemoSignerNoEffectRecoveryActionV1 } from './demo-signer-no-effect-recovery'
import { DEMO_SIGNER_PRE_EFFECT_RECOVERY_REASON, DemoSignerRpcJournalV2 } from './demo-signer-rpc-journal-v2'

const roots: string[] = []
const H = (byte: string) => byte.repeat(64)
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture() {
	const root = await mkdtemp('/tmp/plebeian-signer-no-effect-recovery.'); roots.push(root); await chmod(root, 0o700)
	const stateDirectory = join(root, 'state'), node = join(root, 'node-1'), backupParent = join(root, 'recovery')
	await mkdir(stateDirectory, { mode: 0o700 }); await mkdir(node, { mode: 0o700 }); await mkdir(backupParent, { mode: 0o700 })
	await writeFile(join(stateDirectory, 'dkg-final.state'), '{"synthetic":"share-state"}\n', { flag: 'wx', mode: 0o600 })
	const paths = {
		stateDirectory, signerMetadataPath: join(stateDirectory, 'disposition-metadata.sqlite3'),
		proofUsePath: join(node, 'terminal-proof-use.sqlite3'), coordinatorAnchorPath: join(node, 'signer-safety-anchor.sqlite3'),
		admissionSafetyPath: join(node, 'admission-safety.sqlite3'), enrollmentPermitPath: join(node, 'enrollment-permit.json'),
		leasePath: join(node, 'signer-service-v2.lock'), quarantinePath: join(node, 'signer-service-v2.quarantine'),
		scratchParent: join(node, 'scratch'),
	}
	const identity = { participantId: 1 as const, dkgRunId: 'dkg-test', publicKeyPackageSha256: H('1'), signerRosterDigest: H('2') }
	await writeFile(paths.enrollmentPermitPath, `${JSON.stringify(demoDispositionEnrollmentPermit(identity))}\n`, { flag: 'wx', mode: 0o600 })
	const anchor = openDemoDispositionSignerAnchor({ ...identity, ...paths, initialEnrollmentPermitPath: paths.enrollmentPermitPath })
	const database = new Database(paths.admissionSafetyPath, { create: false, strict: true })
	const journal = new DemoSignerRpcJournalV2<unknown>(database, 'demo_fips_admission_rpc_journal', anchor)
	anchor.claimAdmissionProofs([1, 2, 3].map((index) => ({ proofRef: `02${String(index).repeat(64)}`,
		network: 'network', chainId: 'chain', auctionId: 'auction', operationId: 'failed-operation' })))
	const policyId = H('3'), policyDigest = H('4'), commitId = H('5'), commitDigest = H('6')
	expect(await journal.claim(policyId, policyDigest)).toEqual({ status: 'created' })
	await journal.complete(policyId, policyDigest, { policy: 'accepted' })
	expect(await journal.claim(commitId, commitDigest)).toEqual({ status: 'created' })
	database.close(false); anchor.close()
	await writeFile(paths.leasePath, '', { flag: 'wx', mode: 0o600 })
	await writeFile(paths.quarantinePath, 'SIGNER_LOCAL_UNCERTAINTY_V2\n', { flag: 'wx', mode: 0o600 })
	for (const path of [paths.signerMetadataPath, paths.proofUsePath, paths.coordinatorAnchorPath,
		paths.admissionSafetyPath, paths.leasePath, paths.quarantinePath]) await chmod(path, 0o600)
	const action: DemoSignerNoEffectRecoveryActionV1 = {
		schema: 'PLEBEIAN_SIGNER_NO_EFFECT_RECOVERY_ACTION_V1', ...identity,
		runtimeUid: process.geteuid!(), runtimeGid: process.getegid!(), backupDirectory: join(backupParent, 'action-1'), paths,
	}
	return { root, action, policyId, policyDigest, commitId, commitDigest }
}

function status(path: string) {
	const database = new Database(path, { readonly: true, strict: true })
	try {
		return {
			rows: database.query<{ request_id: string; status: string; rejection_reason: string | null; rejection_body: string | null }, []>(
				'SELECT request_id,status,rejection_reason,rejection_body FROM demo_fips_admission_rpc_journal ORDER BY request_id',
			).all(),
			revision: database.query<{ revision: number }, []>('SELECT revision FROM admission_safety_metadata WHERE id=1').get()!.revision,
		}
	} finally { database.close(false) }
}

test('offline recovery preserves the row as anchored rejected_no_effect and releases only the exact marker', async () => {
	const f = await fixture(), result = await recoverDemoSignerPendingBeforeEffect(f.action)
	expect(result).toMatchObject({ schema: 'PLEBEIAN_SIGNER_NO_EFFECT_RECOVERY_RESULT_V1', status: 'COMPLETE', participantId: 1,
		before: { admission: { complete: 1, pending: 1, rejected_no_effect: 0 }, admissionRevision: 4, admissionAnchorRevision: 4, rustAnchorRevision: 0 },
		after: { admission: { complete: 1, pending: 0, rejected_no_effect: 1 }, admissionRevision: 5, admissionAnchorRevision: 5, rustAnchorRevision: 0 } })
	const current = status(f.action.paths.admissionSafetyPath)
	expect(current.revision).toBe(5); expect(current.rows.map(({ request_id }) => request_id)).toEqual([f.policyId, f.commitId].sort())
	const recovered = current.rows.find(({ request_id }) => request_id === f.commitId)!
	expect(recovered).toEqual({ request_id: f.commitId, status: 'rejected_no_effect',
		rejection_reason: DEMO_SIGNER_PRE_EFFECT_RECOVERY_REASON,
		rejection_body: `{"error":"DEMO_SIGNER_RECOVERED_NO_EFFECT:${DEMO_SIGNER_PRE_EFFECT_RECOVERY_REASON}"}` })
	await expect(lstat(f.action.paths.quarantinePath)).rejects.toMatchObject({ code: 'ENOENT' })
	expect(await readFile(join(f.action.backupDirectory, 'signer-service-v2.quarantine.released'), 'utf8')).toBe('SIGNER_LOCAL_UNCERTAINTY_V2\n')
	expect(await readFile(join(f.action.backupDirectory, 'signer-service-v2.quarantine.backup'), 'utf8')).toBe('SIGNER_LOCAL_UNCERTAINTY_V2\n')
	await expect(lstat(f.action.paths.scratchParent)).rejects.toMatchObject({ code: 'ENOENT' })
	for (const name of ['admission-safety.sqlite3.backup','signer-safety-anchor.sqlite3.backup','disposition-metadata.sqlite3.backup','PRE-RECOVERY.json','RECOVERY.json']) {
		const metadata = await lstat(join(f.action.backupDirectory, name)); expect(metadata.isFile()).toBe(true); expect(metadata.mode & 0o777).toBe(0o600)
	}
	const backup = status(join(f.action.backupDirectory, 'admission-safety.sqlite3.backup'))
	expect(backup.revision).toBe(4); expect(backup.rows.map(({ status }) => status).sort()).toEqual(['complete','pending'])

	const anchor = openDemoDispositionSignerAnchor({ participantId: 1, dkgRunId: f.action.dkgRunId,
		publicKeyPackageSha256: f.action.publicKeyPackageSha256, signerRosterDigest: f.action.signerRosterDigest,
		stateDirectory: f.action.paths.stateDirectory, signerMetadataPath: f.action.paths.signerMetadataPath,
		proofUsePath: f.action.paths.proofUsePath, coordinatorAnchorPath: f.action.paths.coordinatorAnchorPath,
		initialEnrollmentPermitPath: f.action.paths.enrollmentPermitPath, admissionSafetyPath: f.action.paths.admissionSafetyPath })
	const database = new Database(f.action.paths.admissionSafetyPath, { create: false, strict: true })
	try {
		const journal = new DemoSignerRpcJournalV2(database, 'demo_fips_admission_rpc_journal', anchor)
		await expect(journal.assertReady()).resolves.toBeUndefined()
		expect(await journal.inspect(f.commitId, f.commitDigest)).toEqual({ status: 'rejected',
			body: `{"error":"DEMO_SIGNER_RECOVERED_NO_EFFECT:${DEMO_SIGNER_PRE_EFFECT_RECOVERY_REASON}"}` })
	} finally { database.close(false); anchor.close() }
})

for (const mismatch of ['scratch','rust','marker','second-pending'] as const) test(`evidence mismatch ${mismatch} stops before backup or transition`, async () => {
	const f = await fixture()
	if (mismatch === 'scratch') await mkdir(f.action.paths.scratchParent, { mode: 0o700 })
	if (mismatch === 'rust') await writeFile(join(f.action.paths.stateDirectory, `admission-sign-${H('7')}.journal`), '{}', { mode: 0o600 })
	if (mismatch === 'marker') await writeFile(f.action.paths.quarantinePath, 'changed\n')
	if (mismatch === 'second-pending') {
		const database = new Database(f.action.paths.admissionSafetyPath, { create: false, strict: true })
		try { database.query("INSERT INTO demo_fips_admission_rpc_journal(request_id,request_digest,status) VALUES(?,?,'pending')").run(H('8'), H('9')) }
		finally { database.close(false) }
	}
	await expect(recoverDemoSignerPendingBeforeEffect(f.action)).rejects.toThrow(/DEMO_SIGNER_NO_EFFECT_RECOVERY/)
	await expect(lstat(f.action.backupDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
	expect((await lstat(f.action.paths.quarantinePath)).isFile()).toBe(true)
	const rows = status(f.action.paths.admissionSafetyPath).rows
	expect(rows.some(({ request_id, status }) => request_id === f.commitId && status === 'pending')).toBe(true)
})

test('unsafe quarantine symlink is rejected without following it', async () => {
	const f = await fixture(), held = join(f.root, 'held-marker')
	await rm(f.action.paths.quarantinePath); await writeFile(held, 'SIGNER_LOCAL_UNCERTAINTY_V2\n', { mode: 0o600 })
	await symlink(held, f.action.paths.quarantinePath)
	await expect(recoverDemoSignerPendingBeforeEffect(f.action)).rejects.toThrow(/runtime-owned 0600 regular file/)
	await expect(lstat(f.action.backupDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('tool refuses an action for another runtime identity before filesystem mutation', async () => {
	const f = await fixture()
	await expect(recoverDemoSignerPendingBeforeEffect({ ...f.action, runtimeUid: f.action.runtimeUid + 1 })).rejects.toThrow(/exact signer runtime identity/)
	await expect(lstat(f.action.backupDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
	expect(status(f.action.paths.admissionSafetyPath).rows.some(({ status }) => status === 'pending')).toBe(true)
})
