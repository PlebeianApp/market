/** Coordinator-side adapter to the Rust four-of-four aggregation verifier. */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { demoFrostTranscriptHash, type DemoFrostAggregatePort } from './demo-sigall-settlement'
import type { DemoFrostRustAuthorization } from './demo-frost-rust-participant-worker'

const VERSION = 'COCO_DEMO_FROST_PARTICIPANT_V1'
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const PARTICIPANT_IDS = [1, 2, 3, 4] as const
const AUTH_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_SIGALL_AUTH_V1')
const TRANSCRIPT_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_SIGNING_TRANSCRIPT_V1')

export interface DemoFrostRustAggregateOptions {
	binaryPath: string
	publicKeyPackagePath: string
	scratchParent: string
	authorization: DemoFrostRustAuthorization
	/** Test seam only. Production must omit this and execute the pinned Rust binary. */
	runCommand?: (command: string[]) => Promise<void>
}

function requireAbsolute(value: string, field: string): void {
	if (!value.startsWith('/') || value === '/' || value.endsWith('/') || value.includes('//') || value.split('/').some((part) => part === '.' || part === '..')) {
		throw new Error(`DEMO_FROST_AGGREGATE_PATH: ${field} must be a canonical absolute path`)
	}
}

async function defaultRunCommand(command: string[]): Promise<void> {
	const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
	const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
	if (exitCode !== 0) throw new Error(`DEMO_FROST_AGGREGATE_COMMAND: exited ${exitCode}: ${stderr.trim() || 'no diagnostic'}`)
}

function lengthPrefix(value: Uint8Array): Uint8Array {
	const prefix = new Uint8Array(4)
	new DataView(prefix.buffer).setUint32(0, value.length, false)
	return concatBytes(prefix, value)
}

export function demoFrostRustAuthorizationDigest(authorization: DemoFrostRustAuthorization): string {
	const framed = [
		authorization.dkg_run_id,
		authorization.committee_keyset_id,
		authorization.committee_keyset_version,
		authorization.public_key_package_sha256,
		authorization.operation_id,
		authorization.policy_package_digest,
		authorization.cashu_sigall_digest,
		authorization.full_package_digest,
		authorization.certified_closure_digest,
		authorization.signed_bid_evidence_digest,
		authorization.committee_locked_proofs_digest,
		authorization.bidder_payout_binding_digest,
	].map((value) => lengthPrefix(utf8ToBytes(value)))
	const roster = new Uint8Array(authorization.roster.length * 2 + 2)
	const view = new DataView(roster.buffer)
	for (const [index, id] of authorization.roster.entries()) view.setUint16(index * 2, id, false)
	view.setUint16(authorization.roster.length * 2, authorization.threshold, false)
	return bytesToHex(sha256(concatBytes(AUTH_CONTEXT, ...framed, roster)))
}

export function demoFrostRustCommitmentsDigest(
	authorization: DemoFrostRustAuthorization,
	commitments: Parameters<DemoFrostAggregatePort['aggregate']>[0]['commitments'],
): string {
	const authDigest = demoFrostRustAuthorizationDigest(authorization)
	const envelopes = commitments.map((entry) => ({
		version: VERSION,
		operation_id: authorization.operation_id,
		authorization_digest: authDigest,
		participant_id: entry.participantId,
		hiding_hex: entry.hiding,
		binding_hex: entry.binding,
	}))
	return bytesToHex(sha256(concatBytes(
		TRANSCRIPT_CONTEXT,
		hexToBytes(authDigest),
		utf8ToBytes(JSON.stringify(envelopes)),
	)))
}

function snapshotAuthorization(source: DemoFrostRustAuthorization): DemoFrostRustAuthorization {
	const authorization: DemoFrostRustAuthorization = {
		...source,
		roster: [...source.roster] as [1, 2, 3, 4],
	}
	if (authorization.version !== VERSION
		|| JSON.stringify(authorization.roster) !== '[1,2,3,4]'
		|| authorization.threshold !== 4) {
		throw new Error('DEMO_FROST_AGGREGATE_AUTHORIZATION: exact four-of-four authorization required')
	}
	for (const [field, value] of Object.entries({
		publicKeyPackageSha256: authorization.public_key_package_sha256,
		policyPackageDigest: authorization.policy_package_digest,
		cashuSigAllDigest: authorization.cashu_sigall_digest,
		fullPackageDigest: authorization.full_package_digest,
		certifiedClosureDigest: authorization.certified_closure_digest,
		signedBidEvidenceDigest: authorization.signed_bid_evidence_digest,
		committeeLockedProofsDigest: authorization.committee_locked_proofs_digest,
		bidderPayoutBindingDigest: authorization.bidder_payout_binding_digest,
	})) {
		if (!HEX_32.test(value)) throw new Error(`DEMO_FROST_AGGREGATE_AUTHORIZATION: ${field} is malformed`)
	}
	return authorization
}

export function createDemoFrostRustAggregatePort(options: DemoFrostRustAggregateOptions): DemoFrostAggregatePort {
	const binaryPath = options.binaryPath
	const publicKeyPackagePath = options.publicKeyPackagePath
	const scratchParent = options.scratchParent
	const authorization = snapshotAuthorization(options.authorization)
	const runCommand = options.runCommand ?? defaultRunCommand
	const expectedAuthorizationDigest = demoFrostRustAuthorizationDigest(authorization)
	for (const [field, value] of Object.entries({
		binaryPath,
		publicKeyPackagePath,
		scratchParent,
	})) requireAbsolute(value, field)
	return {
		async aggregate(request) {
			const exactRequest = structuredClone(request)
			if (exactRequest.digest !== authorization.cashu_sigall_digest
				|| exactRequest.packageDigest !== authorization.full_package_digest) {
				throw new Error('DEMO_FROST_AGGREGATE_BINDING: aggregate request differs from participant authorization')
			}
			if (exactRequest.commitments.length !== 4 || exactRequest.shares.length !== 4) {
				throw new Error('PAYMENT_BLOCKED_MISSING_PARTICIPANT: exactly four commitments and shares are required')
			}
			const commitmentIds = exactRequest.commitments.map((entry) => entry.participantId)
			const shareIds = exactRequest.shares.map((entry) => entry.participantId)
			if (JSON.stringify(commitmentIds) !== '[1,2,3,4]' || JSON.stringify(shareIds) !== '[1,2,3,4]') {
				throw new Error('PAYMENT_BLOCKED_MISSING_PARTICIPANT: exact [1,2,3,4] roster required')
			}
			const transcriptHash = demoFrostTranscriptHash({
				sessionId: exactRequest.sessionId,
				digest: exactRequest.digest,
				packageDigest: exactRequest.packageDigest,
				committeeKeysetId: authorization.committee_keyset_id,
				committeeKeysetVersion: authorization.committee_keyset_version,
			}, exactRequest.commitments)
			if (exactRequest.transcriptHash !== transcriptHash) {
				throw new Error('DEMO_FROST_AGGREGATE_TRANSCRIPT: transcript hash was not derived from the exact commitments')
			}
			const xCoordinates: string[] = []
			for (const [index, commitment] of exactRequest.commitments.entries()) {
				if (commitment.participantId !== PARTICIPANT_IDS[index]
					|| commitment.sessionId !== exactRequest.sessionId
					|| commitment.digest !== exactRequest.digest
					|| !COMPRESSED_KEY.test(commitment.hiding)
					|| !COMPRESSED_KEY.test(commitment.binding)) {
					throw new Error('DEMO_FROST_AGGREGATE_TRANSCRIPT: malformed or mismatched commitment')
				}
				xCoordinates.push(commitment.hiding.slice(2), commitment.binding.slice(2))
			}
			if (new Set(xCoordinates).size !== xCoordinates.length) {
				throw new Error('DEMO_FROST_AGGREGATE_TRANSCRIPT: duplicate nonce commitment')
			}
			for (const [index, share] of exactRequest.shares.entries()) {
				if (share.participantId !== PARTICIPANT_IDS[index]
					|| share.sessionId !== exactRequest.sessionId
					|| share.digest !== exactRequest.digest
					|| share.transcriptHash !== transcriptHash
					|| !HEX_32.test(share.share)) {
					throw new Error('DEMO_FROST_AGGREGATE_TRANSCRIPT: malformed or mismatched signature share')
				}
			}
			if (new Set(exactRequest.shares.map((entry) => entry.share)).size !== 4) {
				throw new Error('DEMO_FROST_AGGREGATE_TRANSCRIPT: duplicate signature share')
			}
			const commitmentsDigest = demoFrostRustCommitmentsDigest(authorization, exactRequest.commitments)
			const directory = await mkdtemp(join(scratchParent, 'coco-frost-aggregate-'))
			await chmod(directory, 0o700)
			try {
				const authorizationPath = join(directory, 'authorization.json')
				const requestPath = join(directory, 'aggregate-request.json')
				const outputPath = join(directory, 'signature.json')
				await writeFile(authorizationPath, `${JSON.stringify(authorization)}\n`, { mode: 0o600, flag: 'wx' })
				await writeFile(requestPath, `${JSON.stringify({
					version: VERSION,
					operation_id: authorization.operation_id,
					commitments: exactRequest.commitments.map((entry) => ({
						participant_id: entry.participantId,
						hiding_hex: entry.hiding,
						binding_hex: entry.binding,
					})),
					shares: exactRequest.shares.map((entry) => ({
						participant_id: entry.participantId,
						share_hex: entry.share,
					})),
				})}\n`, { mode: 0o600, flag: 'wx' })
				await runCommand([
					binaryPath,
					'aggregate',
					authorizationPath,
					publicKeyPackagePath,
					requestPath,
					outputPath,
				])
				const output = JSON.parse(await readFile(outputPath, 'utf8')) as {
					version: string
					operation_id: string
					authorization_digest: string
					cashu_sigall_digest: string
					commitments_digest: string
					signature_hex: string
				}
				if (output.version !== VERSION
					|| output.operation_id !== authorization.operation_id
					|| output.authorization_digest !== expectedAuthorizationDigest
					|| output.cashu_sigall_digest !== exactRequest.digest
					|| output.commitments_digest !== commitmentsDigest
					|| !HEX_64.test(output.signature_hex)) {
					throw new Error('DEMO_FROST_AGGREGATE_OUTPUT: Rust verifier returned malformed or mismatched output')
				}
				return { signature: output.signature_hex, transcriptHash }
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		},
	}
}
