import { describe, expect, spyOn, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	assembleDemoFridayDkgAgreementBundleV1,
	assembleDemoFridayDkgEncryptedRound2BundleV1,
	assembleDemoFridayDkgRound1BundleV1,
	composeDemoFridayAuthenticatedDkgResultV2,
	DEMO_FRIDAY_DKG_MAX_R2_CIPHERTEXT_BYTES,
	DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA,
	executeDemoFridayDkgRelayRequestV1,
	routeDemoFridayDkgConfirmationsV1,
} from './demo-friday-per-validator-dkg-relay'
import {
	DEMO_FRIDAY_DKG_CONFIRMATION_SCHEMA,
	demoFridayDkgManifestDigest,
	demoFridayDkgRosterDigest,
	type DemoFridayDkgPublicManifestV1,
} from './demo-friday-per-validator-dkg-bootstrap'

const VERSION = 'COCO_DEMO_FROST_PARTICIPANT_3OF4_V1'
const npubFill = ['q', 'p', 'z', 'r'] as const
const kexFill = ['9', 'a', 'b', 'c'] as const
const dkgPrivateKeys = ([1, 2, 3, 4] as const).map((value) => Uint8Array.from({ length: 32 }, () => value))
const signerPrivateKeys = ([5, 6, 7, 8] as const).map((value) => Uint8Array.from({ length: 32 }, () => value))
const participants = ([1, 2, 3, 4] as const).map((participantId) => ({
	participantId, hostId: `linode-10000${participantId}`, underlayIpv4: `198.18.242.${participantId}`,
	fipsNpub: `npub1${npubFill[participantId - 1]!.repeat(58)}`, fipsUla: `fd42::${participantId}`,
	dkgIdentity: bytesToHex(schnorr.getPublicKey(dkgPrivateKeys[participantId - 1]!)),
	signerIdentity: bytesToHex(schnorr.getPublicKey(signerPrivateKeys[participantId - 1]!)),
	kexPublicKey: kexFill[participantId - 1]!.repeat(64), signerEndpoint: `http://[fd42::${participantId}]:39101/v1/frost`,
	participantBinarySha256: 'a'.repeat(64), inspectorBinarySha256: 'b'.repeat(64),
	configPath: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json',
	stateDirectory: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/state',
}))

function manifest(): DemoFridayDkgPublicManifestV1 {
	const base = {
		schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1' as const,
		valueProfile: 'FAKE_MONEY_ONLY' as const,
		deploymentId: 'friday-r1', applicationRunId: 'application-r1', dkgRunId: 'dkg-r1',
		committeeKeysetId: 'committee-v1', committeeKeysetVersion: '1', coordinatorIdentity: 'e'.repeat(64),
		roster: [1, 2, 3, 4] as const, coordinatorParticipantId: 1 as const,
		participants: participants as unknown as DemoFridayDkgPublicManifestV1['participants'], rosterDigest: '',
	}
	base.rosterDigest = demoFridayDkgRosterDigest(base.participants)
	return base
}

function frame(domain: string, fields: unknown[]): Uint8Array {
	return utf8ToBytes(JSON.stringify([domain, ...fields]))
}

function digestValue(domain: string, fields: unknown[]): string {
	return bytesToHex(sha256(frame(domain, fields)))
}

function signDigest(domain: string, messageDigest: string, participantId: 1 | 2 | 3 | 4): string {
	return bytesToHex(schnorr.sign(
		hexToBytes(messageDigest), dkgPrivateKeys[participantId - 1]!,
		sha256(frame(`${domain}_AUX`, [messageDigest])),
	))
}

function u16be(value: 1 | 2 | 3 | 4): Uint8Array {
	return Uint8Array.of(0, value)
}

function rustFrame(context: string, fields: readonly Uint8Array[]): Uint8Array {
	const contextBytes = utf8ToBytes(context)
	const size = contextBytes.length + fields.reduce((total, field) => total + 4 + field.length, 0)
	const output = new Uint8Array(size)
	output.set(contextBytes)
	let offset = contextBytes.length
	for (const field of fields) {
		new DataView(output.buffer).setUint32(offset, field.length, false)
		offset += 4
		output.set(field, offset)
		offset += field.length
	}
	return output
}

function signRust(
	context: string, fields: readonly Uint8Array[], participantId: 1 | 2 | 3 | 4, hashRounds = 1,
): string {
	let message = rustFrame(context, fields)
	for (let index = 0; index < hashRounds; index += 1) message = sha256(message)
	return bytesToHex(schnorr.sign(message, dkgPrivateKeys[participantId - 1]!))
}

async function runRelayCli(input: string): Promise<{ status: number; stdout: string; stderr: string }> {
	const child = Bun.spawn([process.execPath, `${import.meta.dir}/demo-friday-per-validator-dkg-relay-cli.ts`], {
		cwd: import.meta.dir, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
	})
	child.stdin.write(input)
	child.stdin.end()
	const [status, stdout, stderr] = await Promise.all([
		child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
	])
	return { status, stdout, stderr }
}

describe('public/ciphertext-only DKG relay', () => {
	test('routes each authenticated confirmation only to its declared peer', () => {
		const value = manifest(); const digest = demoFridayDkgManifestDigest(value)
		const sourceBundles = ([1, 2, 3, 4] as const).map((sender) => ({
			schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_CONFIRMATION_BUNDLE_V1' as const,
			manifestDigest: digest, participantId: sender,
			entries: ([1, 2, 3, 4] as const).filter((recipient) => recipient !== sender).map((recipient) => {
				const unsigned = {
					schema: DEMO_FRIDAY_DKG_CONFIRMATION_SCHEMA, manifestDigest: digest, rosterDigest: value.rosterDigest,
					purpose: 'COCO_DEMO_FROST_DKG_ROUND2_PAIRWISE_KEY_V1' as const,
					lowerParticipantId: Math.min(sender, recipient) as 1 | 2 | 3 | 4,
					upperParticipantId: Math.max(sender, recipient) as 1 | 2 | 3 | 4,
					senderParticipantId: sender, recipientParticipantId: recipient,
					lowerKexPublicKey: value.participants[Math.min(sender, recipient) - 1]!.kexPublicKey,
					upperKexPublicKey: value.participants[Math.max(sender, recipient) - 1]!.kexPublicKey,
					confirmationMac: 'c'.repeat(64), dkgIdentity: value.participants[sender - 1]!.dkgIdentity,
				}
				const messageDigest = digestValue('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_KEY_CONFIRMATION_SIGNATURE_V1', [
					unsigned.schema, unsigned.manifestDigest, unsigned.rosterDigest, unsigned.purpose,
					unsigned.lowerParticipantId, unsigned.upperParticipantId, unsigned.senderParticipantId,
					unsigned.recipientParticipantId, unsigned.lowerKexPublicKey, unsigned.upperKexPublicKey,
					unsigned.confirmationMac, unsigned.dkgIdentity,
				])
				return { ...unsigned, signature: signDigest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_KEY_CONFIRMATION_SIGNATURE_V1', messageDigest, sender) }
			}),
		}))
		const routed = routeDemoFridayDkgConfirmationsV1({
			manifest: value, expectedManifestDigest: digest, sourceBundles,
		})
		expect(routed).toHaveLength(4)
		expect(routed[1]!.participantId).toBe(2)
		expect(routed[1]!.entries.map((entry) => entry.senderParticipantId)).toEqual([1, 3, 4])
		expect(routed[1]!.entries.every((entry) => entry.recipientParticipantId === 2)).toBe(true)

		const secretBearing = structuredClone(sourceBundles) as unknown as Array<Record<string, unknown>>
		;(secretBearing[0]!.entries as Array<Record<string, unknown>>)[0]!.key_hex = '11'.repeat(32)
		expect(() => routeDemoFridayDkgConfirmationsV1({
			manifest: value, expectedManifestDigest: digest,
			sourceBundles: secretBearing as never,
		})).toThrow('missing or unexpected fields')
	})

	test('rejects wrong-run public entries and orders an exact four-entry bundle', () => {
		const value = manifest(); const digest = demoFridayDkgManifestDigest(value)
		const entries = ([4, 2, 1, 3] as const).map((sender) => {
			const payload = 'aa'
			return {
				version: VERSION, run_id: value.dkgRunId, committee_keyset_id: value.committeeKeysetId,
				committee_keyset_version: value.committeeKeysetVersion, sender, payload_hex: payload,
				auth_signature_hex: signRust('COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', [
					utf8ToBytes(VERSION), utf8ToBytes(value.dkgRunId), utf8ToBytes(value.committeeKeysetId),
					utf8ToBytes(value.committeeKeysetVersion), u16be(sender), utf8ToBytes(payload),
				], sender),
			}
		})
		const bundle = assembleDemoFridayDkgRound1BundleV1({ manifest: value, expectedManifestDigest: digest, entries })
		expect(bundle.entries.map((entry) => entry.sender)).toEqual([1, 2, 3, 4])
		entries[0]!.run_id = 'other-run'
		expect(() => assembleDemoFridayDkgRound1BundleV1({
			manifest: value, expectedManifestDigest: digest, entries,
		})).toThrow('invalid run or schema binding')
	})

	test('rejects old, double-hashed, wrong-domain and field-mutated round-one contracts', () => {
		const value = manifest(); const digest = demoFridayDkgManifestDigest(value)
		const makeEntry = (sender: 1 | 2 | 3 | 4) => {
			const payload_hex = `${sender}`.repeat(64)
			const fields = [
				utf8ToBytes(VERSION), utf8ToBytes(value.dkgRunId), utf8ToBytes(value.committeeKeysetId),
				utf8ToBytes(value.committeeKeysetVersion), u16be(sender), utf8ToBytes(payload_hex),
			]
			return {
				version: VERSION, run_id: value.dkgRunId, committee_keyset_id: value.committeeKeysetId,
				committee_keyset_version: value.committeeKeysetVersion, sender, payload_hex,
				auth_signature_hex: signRust('COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', fields, sender),
			}
		}
		const valid = ([1, 2, 3, 4] as const).map(makeEntry)
		expect(assembleDemoFridayDkgRound1BundleV1({
			manifest: value, expectedManifestDigest: digest, entries: valid,
		}).entries).toHaveLength(4)
		for (const mutation of ['old', 'double', 'domain', 'run', 'keyset', 'participant', 'payload'] as const) {
			const entries = structuredClone(valid)
			const entry = entries[0]!
			const fields = [
				utf8ToBytes(VERSION), utf8ToBytes(value.dkgRunId), utf8ToBytes(value.committeeKeysetId),
				utf8ToBytes(value.committeeKeysetVersion), u16be(1), utf8ToBytes(entry.payload_hex),
			]
			if (mutation === 'old') entry.auth_signature_hex = signRust('COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', fields, 1, 0)
			if (mutation === 'double') entry.auth_signature_hex = signRust('COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', fields, 1, 2)
			if (mutation === 'domain') entry.auth_signature_hex = signRust('COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1_MUTATED', fields, 1)
			if (mutation === 'run') entry.run_id = 'mutated-run'
			if (mutation === 'keyset') entry.committee_keyset_id = 'mutated-keyset'
			if (mutation === 'participant') entry.sender = 2
			if (mutation === 'payload') entry.payload_hex = `f${entry.payload_hex.slice(1)}`
			expect(() => assembleDemoFridayDkgRound1BundleV1({
				manifest: value, expectedManifestDigest: digest, entries,
			})).toThrow()
		}
	})

	test('verifies all four public transcript agreements before relaying', () => {
		const value = manifest(); const manifestDigest = demoFridayDkgManifestDigest(value)
		const transcript = '7'.repeat(64)
		const entries = ([3, 1, 4, 2] as const).map((participantId) => ({
			version: VERSION, run_id: value.dkgRunId, committee_keyset_id: value.committeeKeysetId,
			committee_keyset_version: value.committeeKeysetVersion, participant_id: participantId,
			round1_digest: transcript,
			auth_signature_hex: signRust('COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1', [
				utf8ToBytes(VERSION), utf8ToBytes(value.dkgRunId), utf8ToBytes(value.committeeKeysetId),
				utf8ToBytes(value.committeeKeysetVersion), u16be(participantId), utf8ToBytes(transcript),
			], participantId),
		}))
		const result = assembleDemoFridayDkgAgreementBundleV1({
			manifest: value, expectedManifestDigest: manifestDigest, entries,
		})
		expect(result.entries.map((entry) => entry.participant_id)).toEqual([1, 2, 3, 4])
		for (const mutation of ['old', 'double', 'domain', 'run', 'keyset', 'participant', 'transcript'] as const) {
			const candidate = structuredClone(entries)
			const entry = candidate[0]!
			const fields = [
				utf8ToBytes(VERSION), utf8ToBytes(value.dkgRunId), utf8ToBytes(value.committeeKeysetId),
				utf8ToBytes(value.committeeKeysetVersion), u16be(3), utf8ToBytes(transcript),
			]
			if (mutation === 'old') entry.auth_signature_hex = signRust(
				'COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1', fields, 3, 0,
			)
			if (mutation === 'double') entry.auth_signature_hex = signRust(
				'COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1', fields, 3, 2,
			)
			if (mutation === 'domain') entry.auth_signature_hex = signRust(
				'COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1_MUTATED', fields, 3,
			)
			if (mutation === 'run') entry.run_id = 'mutated-run'
			if (mutation === 'keyset') entry.committee_keyset_id = 'mutated-keyset'
			if (mutation === 'participant') entry.participant_id = 2
			if (mutation === 'transcript') entry.round1_digest = 'f'.repeat(64)
			expect(() => assembleDemoFridayDkgAgreementBundleV1({
				manifest: value, expectedManifestDigest: manifestDigest, entries: candidate,
			})).toThrow()
		}
	})

	test('emits only the three ciphertext envelopes for one exact recipient', () => {
		const value = manifest(); const digest = demoFridayDkgManifestDigest(value)
		const transcript = '7'.repeat(64); const recipient = 3
		const envelopes = ([4, 1, 2] as const).map((sender) => ({
			version: VERSION, run_id: value.dkgRunId, committee_keyset_id: value.committeeKeysetId,
			committee_keyset_version: value.committeeKeysetVersion, round1_digest: transcript,
			sender, recipient, nonce_hex: `${sender}`.repeat(48), ciphertext_hex: `${sender + 4}`.repeat(64),
		}))
		const bundle = assembleDemoFridayDkgEncryptedRound2BundleV1({
			manifest: value, expectedManifestDigest: digest, recipientParticipantId: recipient,
			round1TranscriptDigest: transcript, envelopes,
		})
		expect(bundle.entries.map((entry) => entry.sender)).toEqual([1, 2, 4])
		expect(bundle.entries.every((entry) => entry.recipient === 3)).toBe(true)
		expect(bundle.entries.map((entry) => entry.ciphertext_hex)).toEqual([
			'5'.repeat(64), '6'.repeat(64), '8'.repeat(64),
		])
		const request = {
			schema: DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA, action: 'round2_bundle' as const,
			manifest: value, expectedManifestDigest: digest, recipientParticipantId: recipient,
			round1TranscriptDigest: transcript, envelopes,
		}
		const log = spyOn(console, 'log').mockImplementation(() => undefined)
		const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
		const error = spyOn(console, 'error').mockImplementation(() => undefined)
		try {
			const first = executeDemoFridayDkgRelayRequestV1(request)
			const second = executeDemoFridayDkgRelayRequestV1(structuredClone(request))
			expect(JSON.stringify(second)).toBe(JSON.stringify(first))
			expect(log).not.toHaveBeenCalled()
			expect(warn).not.toHaveBeenCalled()
			expect(error).not.toHaveBeenCalled()
		} finally {
			log.mockRestore(); warn.mockRestore(); error.mockRestore()
		}
		const wrong = structuredClone(envelopes); wrong[0]!.recipient = 2
		expect(() => assembleDemoFridayDkgEncryptedRound2BundleV1({
			manifest: value, expectedManifestDigest: digest, recipientParticipantId: recipient,
			round1TranscriptDigest: transcript, envelopes: wrong,
		})).toThrow('invalid sender, run, or ciphertext binding')
		const plaintextBearing = structuredClone(envelopes) as Array<Record<string, unknown>>
		plaintextBearing[0]!.plaintext_share_hex = '11'.repeat(32)
		expect(() => assembleDemoFridayDkgEncryptedRound2BundleV1({
			manifest: value, expectedManifestDigest: digest, recipientParticipantId: recipient,
			round1TranscriptDigest: transcript, envelopes: plaintextBearing,
		})).toThrow('missing or unexpected fields')
		expect(() => executeDemoFridayDkgRelayRequestV1({ ...request, outputPath: '/tmp/result.json' }))
			.toThrow('missing or unexpected fields')
	})

	test('rejects a secret-bearing result checkpoint before composition', () => {
		expect(() => composeDemoFridayAuthenticatedDkgResultV2({
			expectedManifestDigest: '0'.repeat(64), manifest: {}, enrollments: [], round1Bundle: {},
			agreementBundle: {}, finalPublicPackages: [], publicInspections: [], finalAttestations: [],
			dkgIdentityPrivateKey: '11'.repeat(32),
		} as never)).toThrow('missing or unexpected fields')
	})

	test('accepts the exact ciphertext ceiling and rejects one byte more', () => {
		const value = manifest(); const manifestDigest = demoFridayDkgManifestDigest(value)
		const transcript = '7'.repeat(64); const recipient = 3
		const envelopes = ([1, 2, 4] as const).map((sender) => ({
			version: VERSION, run_id: value.dkgRunId, committee_keyset_id: value.committeeKeysetId,
			committee_keyset_version: value.committeeKeysetVersion, round1_digest: transcript,
			sender, recipient, nonce_hex: `${sender}`.repeat(48), ciphertext_hex: 'a'.repeat(32),
		}))
		envelopes[0]!.ciphertext_hex = 'a'.repeat(DEMO_FRIDAY_DKG_MAX_R2_CIPHERTEXT_BYTES * 2)
		const exact = assembleDemoFridayDkgEncryptedRound2BundleV1({
			manifest: value, expectedManifestDigest: manifestDigest, recipientParticipantId: recipient,
			round1TranscriptDigest: transcript, envelopes,
		})
		expect(exact.entries[0]!.ciphertext_hex.length).toBe(DEMO_FRIDAY_DKG_MAX_R2_CIPHERTEXT_BYTES * 2)
		envelopes[0]!.ciphertext_hex += 'aa'
		expect(() => assembleDemoFridayDkgEncryptedRound2BundleV1({
			manifest: value, expectedManifestDigest: manifestDigest, recipientParticipantId: recipient,
			round1TranscriptDigest: transcript, envelopes,
		})).toThrow('invalid sender, run, or ciphertext binding')
	})

	test('relays the Rust recipient-decryptable fixture without plaintext exposure', () => {
		const value = manifest()
		value.dkgRunId = 'dkg-demo-1'; value.committeeKeysetId = 'committee-demo'
		const manifestDigest = demoFridayDkgManifestDigest(value)
		const transcript = 'ab'.repeat(32); const recipient = 2
		const ciphertext = '39c3d1e20d11275fd722be34f2fb32403c12b36a950a7f12534c7e72ebc13c21ecd355684b5ec0bb792468bfdc2bda412a8b6d'
		const plaintextHex = bytesToHex(utf8ToBytes('private frost dkg round two package'))
		const envelopes = ([1, 3, 4] as const).map((sender) => ({
			version: VERSION, run_id: value.dkgRunId, committee_keyset_id: value.committeeKeysetId,
			committee_keyset_version: value.committeeKeysetVersion, round1_digest: transcript,
			sender, recipient, nonce_hex: sender === 1 ? '07'.repeat(24) : `${sender}`.repeat(48),
			ciphertext_hex: sender === 1 ? ciphertext : `${sender + 4}`.repeat(64),
		}))
		const result = assembleDemoFridayDkgEncryptedRound2BundleV1({
			manifest: value, expectedManifestDigest: manifestDigest, recipientParticipantId: recipient,
			round1TranscriptDigest: transcript, envelopes,
		})
		expect(result.entries[0]!.ciphertext_hex).toBe(ciphertext)
		expect(JSON.stringify(result)).not.toContain(plaintextHex)
		// The byte-identical fixture is authenticated/decrypted by the Rust
		// round_two_payload_is_pairwise_confidential_authenticated_and_bound test.
	})

	test('CLI bounds input and emits one fixed non-echoing failure', async () => {
		const sentinel = 'PRIVATE_DKG_SENTINEL_MUST_NOT_BE_LOGGED'
		const secretBearing = await runRelayCli(JSON.stringify({
			schema: DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA, action: 'round2_bundle', secret: sentinel,
		}))
		expect(secretBearing).toEqual({ status: 1, stdout: '', stderr: 'Friday DKG relay request rejected\n' })
		expect(secretBearing.stderr).not.toContain(sentinel)
		const oversized = await runRelayCli('x'.repeat(4 * 1024 * 1024 + 1))
		expect(oversized).toEqual({ status: 1, stdout: '', stderr: 'Friday DKG relay request rejected\n' })
	})
})
