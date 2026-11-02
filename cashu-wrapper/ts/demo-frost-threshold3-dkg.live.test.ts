import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'

import { provisionEphemeralDemoThreshold3 } from './demo-frost-threshold3-dkg'
import {
	DEMO_FROST_THRESHOLD3_VERSION,
	demoFrostThreshold3OperationRoot,
	type DemoFrostThreshold3RustAuthorization,
} from './demo-frost-threshold3-rust-participant-worker'

const participantBinary = process.env.FRIDAY_FROST_PARTICIPANT_BINARY
	?? resolve(import.meta.dir, '../frost-participant-3of4/target/debug/coco-demo-frost-participant-3of4-demo')
const inspectorBinary = process.env.FRIDAY_FROST_INSPECTOR_BINARY
	?? resolve(import.meta.dir, '../frost-public-inspect/target/debug/coco-demo-frost-public-inspect')

async function run(command: string[]): Promise<void> {
	const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
	const timeout = setTimeout(() => child.kill(), 20_000)
	try {
		const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
		if (code !== 0) throw new Error(`threshold command exited ${code}: ${stderr.trim()}`)
	} finally { clearTimeout(timeout) }
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T
}

test('fresh dealerless DKG signs with three distinct Rust participants while the fourth is unavailable', async () => {
	const parent = await mkdtemp('/tmp/plebeian-friday-frost-live-')
	const root = join(parent, 'dkg')
	try {
		const dkg = await provisionEphemeralDemoThreshold3({
			root, participantBinaryPath: participantBinary, inspectorBinaryPath: inspectorBinary,
			dkgRunId: `friday-${crypto.randomUUID()}`, committeeKeysetId: `committee-${crypto.randomUUID()}`,
			committeeKeysetVersion: '1',
		})
		expect(dkg.participants).toHaveLength(4)
		expect(new Set(dkg.participants.map((value) => value.verifyingShare)).size).toBe(4)

		const sessionId = '41'.repeat(32)
		const cashuDigest = '42'.repeat(32)
		const stable: Omit<DemoFrostThreshold3RustAuthorization, 'operation_root' | 'session_id'> = {
			version: DEMO_FROST_THRESHOLD3_VERSION, dkg_run_id: dkg.dkgRunId,
			committee_keyset_id: dkg.committeeKeysetId, committee_keyset_version: dkg.committeeKeysetVersion,
			public_key_package_sha256: dkg.publicKeyPackageSha256, operation_id: 'auction-1:outbid-return:bid-1',
			policy_package_digest: '43'.repeat(32), cashu_sigall_digest: cashuDigest,
			full_package_digest: '44'.repeat(32), certified_closure_digest: '45'.repeat(32),
			signed_bid_evidence_digest: '46'.repeat(32), committee_locked_proofs_digest: '47'.repeat(32),
			bidder_payout_binding_digest: '48'.repeat(32), roster: [1, 2, 3, 4], threshold: 3,
		}
		const authorization: DemoFrostThreshold3RustAuthorization = {
			...stable, operation_root: demoFrostThreshold3OperationRoot(stable), session_id: sessionId,
		}
		const authorizationPath = join(parent, 'authorization.json')
		await writeJson(authorizationPath, authorization)

		const selected = dkg.participants.slice(0, 3)
		const commitments: Array<{
			version: string; operation_id: string; session_id: string; authorization_digest: string
			participant_id: number; hiding_hex: string; binding_hex: string
		}> = []
		for (const participant of selected) {
			const output = join(parent, `commitment-${participant.participantId}.json`)
			await run([participantBinary, 'sign-commit', participant.configPath, participant.stateDirectory, authorizationPath, output])
			const envelope = await readJson<typeof commitments[number]>(output)
			commitments.push(envelope)
		}
		const commitmentBundlePath = join(parent, 'commitments.json')
		await writeJson(commitmentBundlePath, { version: DEMO_FROST_THRESHOLD3_VERSION, entries: commitments })

		const shares: Array<{ participant_id: number; share_hex: string }> = []
		for (const participant of selected) {
			const output = join(parent, `share-${participant.participantId}.json`)
			await run([participantBinary, 'sign-share', participant.configPath, participant.stateDirectory, authorizationPath, commitmentBundlePath, output])
			const envelope = await readJson<{ participant_id: number; share_hex: string }>(output)
			shares.push({ participant_id: envelope.participant_id, share_hex: envelope.share_hex })
		}
		const aggregateRequestPath = join(parent, 'aggregate-request.json')
		await writeJson(aggregateRequestPath, {
			version: DEMO_FROST_THRESHOLD3_VERSION, operation_id: authorization.operation_id, session_id: sessionId,
			commitments: commitments.map(({ participant_id, hiding_hex, binding_hex }) => ({ participant_id, hiding_hex, binding_hex })), shares,
		})
		const signaturePath = join(parent, 'signature.json')
		await run([participantBinary, 'aggregate', authorizationPath, dkg.publicKeyPackagePath, aggregateRequestPath, signaturePath])
		const signature = await readJson<{ signature_hex: string; cashu_sigall_digest: string }>(signaturePath)
		expect(signature.cashu_sigall_digest).toBe(cashuDigest)
		expect(schnorr.verify(
			hexToBytes(signature.signature_hex), hexToBytes(cashuDigest), hexToBytes(dkg.committeePublicKey.slice(2)),
		)).toBe(true)

		// The fourth participant is deliberately never called in either signing round.
		expect(selected.map((value) => value.participantId)).toEqual([1, 2, 3])
	} finally {
		await rm(parent, { recursive: true, force: true })
	}
}, 120_000)
