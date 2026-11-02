/**
 * Public/ciphertext-only relay and authenticated-result composer for the
 * per-validator Friday DKG ceremony.
 *
 * This module performs no filesystem or network I/O. It never accepts a path,
 * identity secret, transport secret, or plaintext round-two share. Operators
 * may move its JSON outputs by a separately approved transport; each receiving
 * host still authenticates/decrypts the artifacts locally.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoFridayDkgManifestDigest,
	type DemoFridayDkgEnrollmentAttestationV1,
	type DemoFridayDkgPairwiseConfirmationV1,
	type DemoFridayDkgPublicManifestV1,
	type DemoFridayDkgRound1AgreementBundleV1,
	type DemoFridayDkgRound1BundleV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	assembleDemoFridayAuthenticatedDkgResultV2,
	exactDemoFridayDkgPinnedManifestV2,
	verifyDemoFridayDkgEnrollmentsV2,
	type DemoFridayAuthenticatedDkgCheckpointV2,
	type DemoFridayAuthenticatedDkgResultV2,
} from './demo-friday-per-validator-dkg-bootstrap-v2'
import {
	DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
	type DemoFridayParticipantId,
} from './demo-friday-per-validator-dkg-plan'

const PARTICIPANTS = [1, 2, 3, 4] as const
const HEX_24 = /^[0-9a-f]{48}$/
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const HEX_PAYLOAD = /^[0-9a-f]+$/
const PAIRWISE_PURPOSE = 'COCO_DEMO_FROST_DKG_ROUND2_PAIRWISE_KEY_V1' as const
export const DEMO_FRIDAY_DKG_MAX_R2_CIPHERTEXT_BYTES = 128 * 1024

export const DEMO_FRIDAY_DKG_ENROLLMENT_BUNDLE_SCHEMA =
	'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ENROLLMENT_BUNDLE_V1' as const
export const DEMO_FRIDAY_DKG_CONFIRMATION_BUNDLE_SCHEMA =
	'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_CONFIRMATION_BUNDLE_V1' as const

export interface DemoFridayDkgEnrollmentBundleV1 {
	schema: typeof DEMO_FRIDAY_DKG_ENROLLMENT_BUNDLE_SCHEMA
	manifestDigest: string
	entries: DemoFridayDkgEnrollmentAttestationV1[]
}

export interface DemoFridayDkgConfirmationSourceBundleV1 {
	schema: typeof DEMO_FRIDAY_DKG_CONFIRMATION_BUNDLE_SCHEMA
	manifestDigest: string
	participantId: DemoFridayParticipantId
	entries: DemoFridayDkgPairwiseConfirmationV1[]
}

export interface DemoFridayDkgRecipientConfirmationBundleV1 {
	schema: typeof DEMO_FRIDAY_DKG_CONFIRMATION_BUNDLE_SCHEMA
	manifestDigest: string
	participantId: DemoFridayParticipantId
	entries: DemoFridayDkgPairwiseConfirmationV1[]
}

export interface DemoFridayDkgEncryptedRound2EnvelopeV1 {
	version: typeof DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION
	run_id: string
	committee_keyset_id: string
	committee_keyset_version: string
	round1_digest: string
	sender: DemoFridayParticipantId
	recipient: DemoFridayParticipantId
	nonce_hex: string
	ciphertext_hex: string
}

export interface DemoFridayDkgEncryptedRound2BundleV1 {
	version: typeof DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION
	entries: DemoFridayDkgEncryptedRound2EnvelopeV1[]
}

function fail(message: string): never {
	throw new Error(`DEMO_FRIDAY_DKG_RELAY: ${message}`)
}

function frame(domain: string, fields: unknown[]): Uint8Array {
	return utf8ToBytes(JSON.stringify([domain, ...fields]))
}

function digest(domain: string, fields: unknown[]): string {
	return bytesToHex(sha256(frame(domain, fields)))
}

function confirmationDigest(value: Omit<DemoFridayDkgPairwiseConfirmationV1, 'signature'>): string {
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_KEY_CONFIRMATION_SIGNATURE_V1', [
		value.schema, value.manifestDigest, value.rosterDigest, value.purpose, value.lowerParticipantId,
		value.upperParticipantId, value.senderParticipantId, value.recipientParticipantId,
		value.lowerKexPublicKey, value.upperKexPublicKey, value.confirmationMac, value.dkgIdentity,
	])
}

function u16be(value: DemoFridayParticipantId): Uint8Array {
	return Uint8Array.of(0, value)
}

function rustFrame(context: string, fields: readonly Uint8Array[]): Uint8Array {
	const contextBytes = utf8ToBytes(context)
	const size = contextBytes.length + fields.reduce((total, field) => total + 4 + field.length, 0)
	const output = new Uint8Array(size)
	output.set(contextBytes, 0)
	let offset = contextBytes.length
	for (const field of fields) {
		new DataView(output.buffer).setUint32(offset, field.length, false)
		offset += 4
		output.set(field, offset)
		offset += field.length
	}
	return output
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		fail(`${label} has missing or unexpected fields`)
	}
	return value as Record<string, unknown>
}

function exactParticipant(value: unknown, label: string): DemoFridayParticipantId {
	if (!Number.isInteger(value) || !PARTICIPANTS.includes(value as DemoFridayParticipantId)) {
		fail(`${label} must be participant 1..4`)
	}
	return value as DemoFridayParticipantId
}

function exactManifest(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
}): DemoFridayDkgPublicManifestV1 {
	return exactDemoFridayDkgPinnedManifestV2(options)
}

export function assembleDemoFridayDkgEnrollmentBundleV1(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	entries: readonly DemoFridayDkgEnrollmentAttestationV1[]
}): DemoFridayDkgEnrollmentBundleV1 {
	const manifest = exactManifest(options)
	const entries = verifyDemoFridayDkgEnrollmentsV2({
		manifest, expectedManifestDigest: options.expectedManifestDigest, enrollments: options.entries,
	})
	return {
		schema: DEMO_FRIDAY_DKG_ENROLLMENT_BUNDLE_SCHEMA,
		manifestDigest: options.expectedManifestDigest,
		entries: structuredClone(entries),
	}
}

function exactConfirmation(
	value: unknown,
	manifest: DemoFridayDkgPublicManifestV1,
	expectedManifestDigest: string,
	sender: DemoFridayParticipantId,
): DemoFridayDkgPairwiseConfirmationV1 {
	const raw = exactObject(value, [
		'schema', 'manifestDigest', 'rosterDigest', 'purpose', 'lowerParticipantId', 'upperParticipantId',
		'senderParticipantId', 'recipientParticipantId', 'lowerKexPublicKey', 'upperKexPublicKey',
		'confirmationMac', 'dkgIdentity', 'signature',
	], 'pairwise confirmation')
	const recipient = exactParticipant(raw.recipientParticipantId, 'confirmation recipient')
	const lower = exactParticipant(raw.lowerParticipantId, 'confirmation lower participant')
	const upper = exactParticipant(raw.upperParticipantId, 'confirmation upper participant')
	const expectedLower = Math.min(sender, recipient)
	const expectedUpper = Math.max(sender, recipient)
	const senderManifest = manifest.participants[sender - 1]!
	const lowerManifest = manifest.participants[expectedLower - 1]!
	const upperManifest = manifest.participants[expectedUpper - 1]!
	if (raw.schema !== 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_KEY_CONFIRMATION_V1'
		|| raw.manifestDigest !== expectedManifestDigest || raw.rosterDigest !== manifest.rosterDigest
		|| raw.purpose !== PAIRWISE_PURPOSE || raw.senderParticipantId !== sender || recipient === sender
		|| lower !== expectedLower || upper !== expectedUpper
		|| raw.lowerKexPublicKey !== lowerManifest.kexPublicKey || raw.upperKexPublicKey !== upperManifest.kexPublicKey
		|| raw.dkgIdentity !== senderManifest.dkgIdentity || typeof raw.confirmationMac !== 'string'
		|| !HEX_32.test(raw.confirmationMac) || typeof raw.signature !== 'string' || !HEX_64.test(raw.signature)) {
		fail(`confirmation from participant ${sender} has invalid roster, run, or recipient binding`)
	}
	const unsigned = { ...raw }
	delete unsigned.signature
	// Match Rust k256's `Signer`: SHA-256(frame) is the BIP-340 message.
	if (!schnorr.verify(
		hexToBytes(raw.signature),
		hexToBytes(confirmationDigest(unsigned as unknown as Omit<DemoFridayDkgPairwiseConfirmationV1, 'signature'>)),
		hexToBytes(senderManifest.dkgIdentity),
	)) fail(`confirmation from participant ${sender} has an invalid identity signature`)
	return structuredClone(raw) as unknown as DemoFridayDkgPairwiseConfirmationV1
}

export function routeDemoFridayDkgConfirmationsV1(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	sourceBundles: readonly DemoFridayDkgConfirmationSourceBundleV1[]
}): DemoFridayDkgRecipientConfirmationBundleV1[] {
	const manifest = exactManifest(options)
	if (options.sourceBundles.length !== 4) fail('exactly four source confirmation bundles are required')
	const bySender = new Map<DemoFridayParticipantId, DemoFridayDkgPairwiseConfirmationV1[]>()
	for (const value of options.sourceBundles) {
		const raw = exactObject(value, ['schema', 'manifestDigest', 'participantId', 'entries'], 'confirmation source bundle')
		const sender = exactParticipant(raw.participantId, 'confirmation source')
		if (bySender.has(sender) || raw.schema !== DEMO_FRIDAY_DKG_CONFIRMATION_BUNDLE_SCHEMA
			|| raw.manifestDigest !== options.expectedManifestDigest || !Array.isArray(raw.entries)
			|| raw.entries.length !== 3) fail('confirmation source bundle is duplicate or differently bound')
		const entries = raw.entries.map((entry) => exactConfirmation(entry, manifest, options.expectedManifestDigest, sender))
		const recipients = entries.map((entry) => entry.recipientParticipantId).sort()
		const expected = PARTICIPANTS.filter((participant) => participant !== sender)
		if (JSON.stringify(recipients) !== JSON.stringify(expected)) fail(`participant ${sender} confirmation recipients are incomplete`)
		bySender.set(sender, entries)
	}
	return PARTICIPANTS.map((recipient) => ({
		schema: DEMO_FRIDAY_DKG_CONFIRMATION_BUNDLE_SCHEMA,
		manifestDigest: options.expectedManifestDigest,
		participantId: recipient,
		entries: PARTICIPANTS.filter((sender) => sender !== recipient).map((sender) => {
			const entry = bySender.get(sender)?.find((candidate) => candidate.recipientParticipantId === recipient)
			if (!entry) fail(`recipient ${recipient} is missing confirmation from participant ${sender}`)
			return structuredClone(entry)
		}),
	}))
}

function exactRound1Entry(value: unknown, manifest: DemoFridayDkgPublicManifestV1): Record<string, unknown> {
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'sender', 'payload_hex', 'auth_signature_hex',
	], 'round-one entry')
	const sender = exactParticipant(raw.sender, 'round-one sender')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== manifest.dkgRunId
		|| raw.committee_keyset_id !== manifest.committeeKeysetId
		|| raw.committee_keyset_version !== manifest.committeeKeysetVersion
		|| typeof raw.payload_hex !== 'string' || !HEX_PAYLOAD.test(raw.payload_hex)
		|| raw.payload_hex.length % 2 !== 0 || raw.payload_hex.length > 131_072
		|| typeof raw.auth_signature_hex !== 'string' || !HEX_64.test(raw.auth_signature_hex)) {
		fail(`round-one entry ${sender} has invalid run or schema binding`)
	}
	const message = rustFrame('COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', [
		utf8ToBytes(raw.version), utf8ToBytes(raw.run_id), utf8ToBytes(raw.committee_keyset_id),
		utf8ToBytes(raw.committee_keyset_version), u16be(sender), utf8ToBytes(raw.payload_hex),
	])
	if (!schnorr.verify(
		hexToBytes(raw.auth_signature_hex), sha256(message), hexToBytes(manifest.participants[sender - 1]!.dkgIdentity),
	)) fail(`round-one entry ${sender} has an invalid identity signature`)
	return structuredClone(raw)
}

function exactAgreementEntry(value: unknown, manifest: DemoFridayDkgPublicManifestV1): Record<string, unknown> {
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'participant_id',
		'round1_digest', 'auth_signature_hex',
	], 'round-one agreement')
	const participant = exactParticipant(raw.participant_id, 'agreement participant')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== manifest.dkgRunId
		|| raw.committee_keyset_id !== manifest.committeeKeysetId
		|| raw.committee_keyset_version !== manifest.committeeKeysetVersion
		|| typeof raw.round1_digest !== 'string' || !HEX_32.test(raw.round1_digest)
		|| typeof raw.auth_signature_hex !== 'string' || !HEX_64.test(raw.auth_signature_hex)) {
		fail(`agreement ${participant} has invalid run or schema binding`)
	}
	const message = rustFrame('COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1', [
		utf8ToBytes(raw.version), utf8ToBytes(raw.run_id), utf8ToBytes(raw.committee_keyset_id),
		utf8ToBytes(raw.committee_keyset_version), u16be(participant), utf8ToBytes(raw.round1_digest),
	])
	if (!schnorr.verify(
		hexToBytes(raw.auth_signature_hex), sha256(message),
		hexToBytes(manifest.participants[participant - 1]!.dkgIdentity),
	)) fail(`agreement ${participant} has an invalid identity signature`)
	return structuredClone(raw)
}

function orderedFour(
	entries: readonly unknown[],
	participantField: 'sender' | 'participant_id',
	validate: (value: unknown) => Record<string, unknown>,
): Record<string, unknown>[] {
	if (entries.length !== 4) fail('public bundle requires exactly four entries')
	const byParticipant = new Map<DemoFridayParticipantId, Record<string, unknown>>()
	for (const value of entries) {
		const entry = validate(value)
		const participant = exactParticipant(entry[participantField], `public ${participantField}`)
		if (byParticipant.has(participant)) fail('public bundle contains a duplicate participant')
		byParticipant.set(participant, entry)
	}
	return PARTICIPANTS.map((participant) => {
		const entry = byParticipant.get(participant)
		if (!entry) fail(`public bundle is missing participant ${participant}`)
		return entry
	})
}

export function assembleDemoFridayDkgRound1BundleV1(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	entries: readonly unknown[]
}): DemoFridayDkgRound1BundleV1 {
	const manifest = exactManifest(options)
	const entries = orderedFour(options.entries, 'sender', (entry) => exactRound1Entry(entry, manifest)) as unknown as DemoFridayDkgRound1BundleV1['entries']
	return {
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
		entries,
	}
}

export function assembleDemoFridayDkgAgreementBundleV1(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	entries: readonly unknown[]
}): DemoFridayDkgRound1AgreementBundleV1 {
	const manifest = exactManifest(options)
	const entries = orderedFour(options.entries, 'participant_id', (entry) => exactAgreementEntry(entry, manifest)) as unknown as DemoFridayDkgRound1AgreementBundleV1['entries']
	return {
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
		entries,
	}
}

function exactEncryptedRound2(
	value: unknown,
	manifest: DemoFridayDkgPublicManifestV1,
	recipient: DemoFridayParticipantId,
	round1Digest: string,
): DemoFridayDkgEncryptedRound2EnvelopeV1 {
	// The courier cannot authenticate R2 without the endpoint-only AEAD key.
	// It validates the complete public context and a hard size bound; the fixed
	// recipient authenticates the ciphertext during local AEAD decryption.
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'round1_digest',
		'sender', 'recipient', 'nonce_hex', 'ciphertext_hex',
	], 'encrypted round-two envelope')
	const sender = exactParticipant(raw.sender, 'round-two sender')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== manifest.dkgRunId
		|| raw.committee_keyset_id !== manifest.committeeKeysetId
		|| raw.committee_keyset_version !== manifest.committeeKeysetVersion || raw.round1_digest !== round1Digest
		|| raw.recipient !== recipient || sender === recipient || typeof raw.nonce_hex !== 'string'
		|| !HEX_24.test(raw.nonce_hex) || typeof raw.ciphertext_hex !== 'string'
		|| !/^[0-9a-f]{32,}$/.test(raw.ciphertext_hex) || raw.ciphertext_hex.length % 2 !== 0
		|| raw.ciphertext_hex.length > DEMO_FRIDAY_DKG_MAX_R2_CIPHERTEXT_BYTES * 2) {
		fail(`round-two envelope for recipient ${recipient} has invalid sender, run, or ciphertext binding`)
	}
	return structuredClone(raw) as unknown as DemoFridayDkgEncryptedRound2EnvelopeV1
}

export function assembleDemoFridayDkgEncryptedRound2BundleV1(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	recipientParticipantId: DemoFridayParticipantId
	round1TranscriptDigest: string
	envelopes: readonly unknown[]
}): DemoFridayDkgEncryptedRound2BundleV1 {
	const manifest = exactManifest(options)
	const recipient = exactParticipant(options.recipientParticipantId, 'round-two recipient')
	if (!HEX_32.test(options.round1TranscriptDigest) || options.envelopes.length !== 3) {
		fail('round-two bundle requires one transcript digest and three encrypted envelopes')
	}
	const bySender = new Map<DemoFridayParticipantId, DemoFridayDkgEncryptedRound2EnvelopeV1>()
	for (const value of options.envelopes) {
		const envelope = exactEncryptedRound2(value, manifest, recipient, options.round1TranscriptDigest)
		if (bySender.has(envelope.sender)) fail('round-two bundle contains a duplicate sender')
		bySender.set(envelope.sender, envelope)
	}
	const expected = PARTICIPANTS.filter((participant) => participant !== recipient)
	return {
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
		entries: expected.map((sender) => {
			const envelope = bySender.get(sender)
			if (!envelope) fail(`round-two recipient ${recipient} is missing sender ${sender}`)
			return envelope
		}),
	}
}

/** Compose only after the V2 assembler revalidates the complete public chain. */
export function composeDemoFridayAuthenticatedDkgResultV2(
	checkpoint: DemoFridayAuthenticatedDkgCheckpointV2,
): DemoFridayAuthenticatedDkgResultV2 {
	const exact = exactObject(checkpoint, [
		'expectedManifestDigest', 'manifest', 'enrollments', 'round1Bundle', 'agreementBundle',
		'finalPublicPackages', 'publicInspections', 'finalAttestations',
	], 'authenticated result checkpoint')
	return assembleDemoFridayAuthenticatedDkgResultV2(exact as unknown as DemoFridayAuthenticatedDkgCheckpointV2)
}

export function demoFridayDkgRelayManifestDigest(manifest: DemoFridayDkgPublicManifestV1): string {
	return demoFridayDkgManifestDigest(manifest)
}

export const DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA = 'PLEBEIAN_FRIDAY_DKG_PUBLIC_RELAY_REQUEST_V1' as const

export type DemoFridayDkgRelayRequestV1 =
	| {
		schema: typeof DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA
		action: 'enrollment_bundle'
		manifest: DemoFridayDkgPublicManifestV1
		expectedManifestDigest: string
		entries: DemoFridayDkgEnrollmentAttestationV1[]
	}
	| {
		schema: typeof DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA
		action: 'route_confirmations'
		manifest: DemoFridayDkgPublicManifestV1
		expectedManifestDigest: string
		sourceBundles: DemoFridayDkgConfirmationSourceBundleV1[]
	}
	| {
		schema: typeof DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA
		action: 'round1_bundle' | 'agreement_bundle'
		manifest: DemoFridayDkgPublicManifestV1
		expectedManifestDigest: string
		entries: unknown[]
	}
	| {
		schema: typeof DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA
		action: 'round2_bundle'
		manifest: DemoFridayDkgPublicManifestV1
		expectedManifestDigest: string
		recipientParticipantId: DemoFridayParticipantId
		round1TranscriptDigest: string
		envelopes: unknown[]
	}
	| {
		schema: typeof DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA
		action: 'compose_authenticated_result'
		checkpoint: DemoFridayAuthenticatedDkgCheckpointV2
	}

/**
 * Pure entry point for a separately approved courier. The exact action DTOs
 * intentionally have no path, URL, secret, or logging fields.
 */
export function executeDemoFridayDkgRelayRequestV1(value: unknown): unknown {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('relay request must be an object')
	const header = value as Record<string, unknown>
	if (header.schema !== DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA || typeof header.action !== 'string') {
		fail('relay request schema or action is invalid')
	}
	switch (header.action) {
		case 'enrollment_bundle': {
			const request = exactObject(value, [
				'schema', 'action', 'manifest', 'expectedManifestDigest', 'entries',
			], 'enrollment relay request')
			if (!Array.isArray(request.entries)) fail('enrollment relay entries must be an array')
			return assembleDemoFridayDkgEnrollmentBundleV1({
				manifest: request.manifest as DemoFridayDkgPublicManifestV1,
				expectedManifestDigest: request.expectedManifestDigest as string,
				entries: request.entries as DemoFridayDkgEnrollmentAttestationV1[],
			})
		}
		case 'route_confirmations': {
			const request = exactObject(value, [
				'schema', 'action', 'manifest', 'expectedManifestDigest', 'sourceBundles',
			], 'confirmation relay request')
			if (!Array.isArray(request.sourceBundles)) fail('confirmation source bundles must be an array')
			return routeDemoFridayDkgConfirmationsV1({
				manifest: request.manifest as DemoFridayDkgPublicManifestV1,
				expectedManifestDigest: request.expectedManifestDigest as string,
				sourceBundles: request.sourceBundles as DemoFridayDkgConfirmationSourceBundleV1[],
			})
		}
		case 'round1_bundle':
		case 'agreement_bundle': {
			const request = exactObject(value, [
				'schema', 'action', 'manifest', 'expectedManifestDigest', 'entries',
			], 'public transcript relay request')
			if (!Array.isArray(request.entries)) fail('public transcript entries must be an array')
			const options = {
				manifest: request.manifest as DemoFridayDkgPublicManifestV1,
				expectedManifestDigest: request.expectedManifestDigest as string,
				entries: request.entries,
			}
			return header.action === 'round1_bundle'
				? assembleDemoFridayDkgRound1BundleV1(options)
				: assembleDemoFridayDkgAgreementBundleV1(options)
		}
		case 'round2_bundle': {
			const request = exactObject(value, [
				'schema', 'action', 'manifest', 'expectedManifestDigest', 'recipientParticipantId',
				'round1TranscriptDigest', 'envelopes',
			], 'encrypted round-two relay request')
			if (!Array.isArray(request.envelopes)) fail('encrypted round-two envelopes must be an array')
			return assembleDemoFridayDkgEncryptedRound2BundleV1({
				manifest: request.manifest as DemoFridayDkgPublicManifestV1,
				expectedManifestDigest: request.expectedManifestDigest as string,
				recipientParticipantId: request.recipientParticipantId as DemoFridayParticipantId,
				round1TranscriptDigest: request.round1TranscriptDigest as string,
				envelopes: request.envelopes,
			})
		}
		case 'compose_authenticated_result': {
			const request = exactObject(value, ['schema', 'action', 'checkpoint'], 'result composer request')
			return composeDemoFridayAuthenticatedDkgResultV2(
				request.checkpoint as DemoFridayAuthenticatedDkgCheckpointV2,
			)
		}
		default:
			fail('relay request action is unsupported')
	}
}
