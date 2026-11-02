/** Coordinator-side adapter to the concrete Rust threshold-three aggregator. */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { demoFrostTranscriptHash, type DemoFrostAggregatePort, type DemoParticipantId } from './demo-sigall-settlement'
import {
	DEMO_FROST_THRESHOLD3_VERSION,
	type DemoFrostThreshold3RustAuthorization,
} from './demo-frost-threshold3-rust-participant-worker'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const AUTH_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_SIGALL_AUTH_V1')
const TRANSCRIPT_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_SIGNING_TRANSCRIPT_V1')

export interface DemoFrostThreshold3RustAggregateOptions {
	binaryPath: string
	publicKeyPackagePath: string
	scratchParent: string
	authorization: DemoFrostThreshold3RustAuthorization
	/** Test seam only. Production must omit this and execute the pinned Rust binary. */
	runCommand?: (command: string[]) => Promise<void>
}

function requireAbsolute(value: string, field: string): void {
	if (!value.startsWith('/') || value === '/' || value.endsWith('/') || value.includes('//') || value.split('/').some((part) => part === '.' || part === '..')) {
		throw new Error(`DEMO_FROST_T3_AGGREGATE_PATH: ${field} must be a canonical absolute path`)
	}
}

async function defaultRunCommand(command: string[]): Promise<void> {
	const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
	const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
	if (exitCode !== 0) throw new Error(`DEMO_FROST_T3_AGGREGATE_COMMAND: exited ${exitCode}: ${stderr.trim() || 'no diagnostic'}`)
}

function lengthPrefix(value: Uint8Array): Uint8Array {
	const prefix = new Uint8Array(4)
	new DataView(prefix.buffer).setUint32(0, value.length, false)
	return concatBytes(prefix, value)
}

export function demoFrostThreshold3AuthorizationDigest(authorization: DemoFrostThreshold3RustAuthorization): string {
	const framed = [
		authorization.dkg_run_id, authorization.committee_keyset_id, authorization.committee_keyset_version,
		authorization.public_key_package_sha256, authorization.operation_id,
		authorization.operation_root, authorization.session_id, authorization.policy_package_digest,
		authorization.cashu_sigall_digest, authorization.full_package_digest, authorization.certified_closure_digest,
		authorization.signed_bid_evidence_digest, authorization.committee_locked_proofs_digest,
		authorization.bidder_payout_binding_digest,
	].map((value) => lengthPrefix(utf8ToBytes(value)))
	const roster = new Uint8Array(10)
	const view = new DataView(roster.buffer)
	for (const [index, id] of authorization.roster.entries()) view.setUint16(index * 2, id, false)
	view.setUint16(8, authorization.threshold, false)
	return bytesToHex(sha256(concatBytes(AUTH_CONTEXT, ...framed, roster)))
}

function selectedIds(commitments: Parameters<DemoFrostAggregatePort['aggregate']>[0]['commitments']): [DemoParticipantId, DemoParticipantId, DemoParticipantId] {
	if (commitments.length !== 3) throw new Error('PAYMENT_BLOCKED_MISSING_PARTICIPANT: exactly three commitments are required')
	const ids = commitments.map((entry) => entry.participantId)
	if (new Set(ids).size !== 3 || ids.some((id, index) => ![1, 2, 3, 4].includes(id) || (index > 0 && ids[index - 1]! >= id))) {
		throw new Error('DEMO_FROST_T3_AGGREGATE_ROSTER: selected ids must be an ordered three-member subset of [1,2,3,4]')
	}
	return ids as [DemoParticipantId, DemoParticipantId, DemoParticipantId]
}

export function demoFrostThreshold3CommitmentsDigest(
	authorization: DemoFrostThreshold3RustAuthorization,
	commitments: Parameters<DemoFrostAggregatePort['aggregate']>[0]['commitments'],
): string {
	const authorizationDigest = demoFrostThreshold3AuthorizationDigest(authorization)
	const envelopes = commitments.map((entry) => ({
		version: DEMO_FROST_THRESHOLD3_VERSION,
		operation_id: authorization.operation_id,
		session_id: authorization.session_id,
		authorization_digest: authorizationDigest,
		participant_id: entry.participantId,
		hiding_hex: entry.hiding,
		binding_hex: entry.binding,
	}))
	return bytesToHex(sha256(concatBytes(TRANSCRIPT_CONTEXT, hexToBytes(authorizationDigest), utf8ToBytes(JSON.stringify(envelopes)))))
}

export function createDemoFrostThreshold3RustAggregatePort(options: DemoFrostThreshold3RustAggregateOptions): DemoFrostAggregatePort {
	const { binaryPath, publicKeyPackagePath, scratchParent } = options
	const authorizationTemplate = structuredClone(options.authorization)
	const runCommand = options.runCommand ?? defaultRunCommand
	for (const [field, value] of Object.entries({ binaryPath, publicKeyPackagePath, scratchParent })) requireAbsolute(value, field)
	if (authorizationTemplate.version !== DEMO_FROST_THRESHOLD3_VERSION || JSON.stringify(authorizationTemplate.roster) !== '[1,2,3,4]' || authorizationTemplate.threshold !== 3) {
		throw new Error('DEMO_FROST_T3_AGGREGATE_AUTHORIZATION: exact three-of-four authorization required')
	}
	for (const value of [authorizationTemplate.public_key_package_sha256, authorizationTemplate.operation_root, authorizationTemplate.session_id, authorizationTemplate.policy_package_digest,
		authorizationTemplate.cashu_sigall_digest, authorizationTemplate.full_package_digest, authorizationTemplate.certified_closure_digest,
		authorizationTemplate.signed_bid_evidence_digest, authorizationTemplate.committee_locked_proofs_digest,
		authorizationTemplate.bidder_payout_binding_digest]) {
		if (!HEX_32.test(value)) throw new Error('DEMO_FROST_T3_AGGREGATE_AUTHORIZATION: malformed digest')
	}

	return {
		async aggregate(request) {
			const exact = structuredClone(request)
			const authorization: DemoFrostThreshold3RustAuthorization = { ...authorizationTemplate, session_id: exact.sessionId }
			const expectedAuthorizationDigest = demoFrostThreshold3AuthorizationDigest(authorization)
			if (exact.digest !== authorization.cashu_sigall_digest || exact.packageDigest !== authorization.full_package_digest) {
				throw new Error('DEMO_FROST_T3_AGGREGATE_BINDING: request differs from participant authorization')
			}
			const ids = selectedIds(exact.commitments)
			if (exact.shares.length !== 3 || JSON.stringify(exact.shares.map((entry) => entry.participantId)) !== JSON.stringify(ids)) {
				throw new Error('PAYMENT_BLOCKED_MISSING_PARTICIPANT: shares must match the exact three-member commitment subset')
			}
			const transcriptHash = demoFrostTranscriptHash({
				sessionId: exact.sessionId,
				digest: exact.digest,
				packageDigest: exact.packageDigest,
				committeeKeysetId: authorization.committee_keyset_id,
				committeeKeysetVersion: authorization.committee_keyset_version,
			}, exact.commitments)
			if (exact.transcriptHash !== transcriptHash) throw new Error('DEMO_FROST_T3_AGGREGATE_TRANSCRIPT: transcript mismatch')
			const noncePoints: string[] = []
			for (const commitment of exact.commitments) {
				if (commitment.sessionId !== exact.sessionId || commitment.digest !== exact.digest
					|| !COMPRESSED_KEY.test(commitment.hiding) || !COMPRESSED_KEY.test(commitment.binding)) {
					throw new Error('DEMO_FROST_T3_AGGREGATE_TRANSCRIPT: malformed commitment')
				}
				noncePoints.push(commitment.hiding.slice(2), commitment.binding.slice(2))
			}
			if (new Set(noncePoints).size !== noncePoints.length) throw new Error('DEMO_FROST_T3_AGGREGATE_TRANSCRIPT: duplicate nonce commitment')
			for (const share of exact.shares) {
				if (share.sessionId !== exact.sessionId || share.digest !== exact.digest || share.transcriptHash !== transcriptHash || !HEX_32.test(share.share)) {
					throw new Error('DEMO_FROST_T3_AGGREGATE_TRANSCRIPT: malformed signature share')
				}
			}
			if (new Set(exact.shares.map((entry) => entry.share)).size !== 3) throw new Error('DEMO_FROST_T3_AGGREGATE_TRANSCRIPT: duplicate signature share')
			const commitmentsDigest = demoFrostThreshold3CommitmentsDigest(authorization, exact.commitments)
			const directory = await mkdtemp(join(scratchParent, 'coco-frost-t3-aggregate-'))
			await chmod(directory, 0o700)
			try {
				const authorizationPath = join(directory, 'authorization.json')
				const requestPath = join(directory, 'aggregate-request.json')
				const outputPath = join(directory, 'signature.json')
				await writeFile(authorizationPath, `${JSON.stringify(authorization)}\n`, { mode: 0o600, flag: 'wx' })
				await writeFile(requestPath, `${JSON.stringify({
					version: DEMO_FROST_THRESHOLD3_VERSION,
					operation_id: authorization.operation_id,
					session_id: authorization.session_id,
					commitments: exact.commitments.map((entry) => ({ participant_id: entry.participantId, hiding_hex: entry.hiding, binding_hex: entry.binding })),
					shares: exact.shares.map((entry) => ({ participant_id: entry.participantId, share_hex: entry.share })),
				})}\n`, { mode: 0o600, flag: 'wx' })
				await runCommand([binaryPath, 'aggregate', authorizationPath, publicKeyPackagePath, requestPath, outputPath])
				const output = JSON.parse(await readFile(outputPath, 'utf8')) as Record<string, string>
				if (output.version !== DEMO_FROST_THRESHOLD3_VERSION || output.operation_id !== authorization.operation_id
					|| output.session_id !== authorization.session_id
					|| output.authorization_digest !== expectedAuthorizationDigest || output.cashu_sigall_digest !== exact.digest
					|| output.commitments_digest !== commitmentsDigest || !HEX_64.test(output.signature_hex ?? '')) {
					throw new Error('DEMO_FROST_T3_AGGREGATE_OUTPUT: malformed or mismatched Rust output')
				}
				return { signature: output.signature_hex!, transcriptHash }
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		},
	}
}
