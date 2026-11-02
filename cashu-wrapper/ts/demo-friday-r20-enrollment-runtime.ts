/**
 * Pure R20 enrollment/runtime boundary.
 *
 * This module performs no I/O. It keeps the established DKG wire schemas but
 * fixes the fresh run to keyset-v2 and binds the independently pinned public
 * result to the separately verified predecessor-abort profile.
 */
import { isIP } from 'node:net'

import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	DEMO_FRIDAY_DKG_ENROLLMENT_SCHEMA, DEMO_FRIDAY_DKG_MANIFEST_SCHEMA,
	demoFridayDkgManifestDigest, exactDemoFridayDkgManifest,
	type DemoFridayDkgManifestParticipantV1, type DemoFridayDkgPublicManifestV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	verifyDemoFridayAuthenticatedDkgResultV2AtRoot,
	type DemoFridayAuthenticatedDkgResultV2,
} from './demo-friday-per-validator-dkg-bootstrap-v2'
import {
	DEMO_FRIDAY_R20_APPLICATION_RUN_ID, DEMO_FRIDAY_R20_DEPLOYMENT_ID,
	DEMO_FRIDAY_R20_COORDINATOR_ROOT,
	DEMO_FRIDAY_R20_DKG_RUN_ID, DEMO_FRIDAY_R20_KEYSET_ID,
	DEMO_FRIDAY_R20_KEYSET_ROOT, DEMO_FRIDAY_R20_KEYSET_VERSION,
	DEMO_FRIDAY_R20_OPERATOR_ROOT, DEMO_FRIDAY_R20_PROFILE_SCHEMA,
	type DemoFridayR20FreshDkgProfileV2,
} from './demo-friday-r20-fresh-profile'

const PARTICIPANTS = [1, 2, 3, 4] as const
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const NPUB = /^npub1[023456789acdefghjklmnpqrstuvwxyz]{58}$/
const HOST = /^linode-[1-9][0-9]{5,11}$/

export const DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA = 'PLEBEIAN_FRIDAY_R20_BOUND_DKG_MANIFEST_V1' as const
export const DEMO_FRIDAY_R20_RUNTIME_BINDING_SCHEMA = 'PLEBEIAN_FRIDAY_R20_RUNTIME_DKG_BINDING_V1' as const

export interface DemoFridayR20BoundManifestV1 {
	schema: typeof DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA
	profileDigest: string
	predecessorAbortDigest: string
	manifest: DemoFridayDkgPublicManifestV1
	manifestDigest: string
	bindingDigest: string
}

export interface DemoFridayR20RuntimeDkgBindingV1 {
	schema: typeof DEMO_FRIDAY_R20_RUNTIME_BINDING_SCHEMA
	valueProfile: 'FAKE_MONEY_ONLY'
	deploymentId: typeof DEMO_FRIDAY_R20_DEPLOYMENT_ID
	applicationRunId: typeof DEMO_FRIDAY_R20_APPLICATION_RUN_ID
	dkgRunId: typeof DEMO_FRIDAY_R20_DKG_RUN_ID
	committeeKeysetId: typeof DEMO_FRIDAY_R20_KEYSET_ID
	committeeKeysetVersion: typeof DEMO_FRIDAY_R20_KEYSET_VERSION
	dkgRoot: typeof DEMO_FRIDAY_R20_KEYSET_ROOT
	coordinatorRoot: string
	predecessorManifestDigest: string
	predecessorAbortDigest: string
	abortAcknowledgementsDigest: string
	manifestDigest: string
	bindingDigest: string
	result: DemoFridayAuthenticatedDkgResultV2
}

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_R20_RUNTIME: ${message}`) }

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		fail(`${label} has missing or unexpected fields`)
	}
	return value as Record<string, unknown>
}

function exactHex(value: unknown, length: 32 | 64, label: string): string {
	const pattern = length === 32 ? HEX_32 : HEX_64
	if (typeof value !== 'string' || !pattern.test(value)) fail(`${label} is not canonical hex`)
	return value
}

function digest(domain: string, fields: unknown[]): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify([domain, ...fields]))))
}

function participantFields(value: DemoFridayDkgManifestParticipantV1): unknown[] {
	return [value.participantId, value.hostId, value.underlayIpv4, value.fipsNpub, value.fipsUla,
		value.dkgIdentity, value.signerIdentity, value.kexPublicKey, value.signerEndpoint,
		value.participantBinarySha256, value.inspectorBinarySha256, value.configPath, value.stateDirectory]
}

export function demoFridayR20ProfileDigest(profile: DemoFridayR20FreshDkgProfileV2): string {
	if (profile.schema !== DEMO_FRIDAY_R20_PROFILE_SCHEMA || profile.valueProfile !== 'FAKE_MONEY_ONLY'
		|| profile.deploymentId !== DEMO_FRIDAY_R20_DEPLOYMENT_ID
		|| profile.applicationRunId !== DEMO_FRIDAY_R20_APPLICATION_RUN_ID
		|| profile.dkgRunId !== DEMO_FRIDAY_R20_DKG_RUN_ID
		|| profile.committeeKeysetId !== DEMO_FRIDAY_R20_KEYSET_ID
		|| profile.committeeKeysetVersion !== DEMO_FRIDAY_R20_KEYSET_VERSION
		|| profile.keysetRoot !== DEMO_FRIDAY_R20_KEYSET_ROOT
		|| profile.configPath !== `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`
		|| profile.transportSecretsPath !== `${DEMO_FRIDAY_R20_KEYSET_ROOT}/transport-secrets.json`
		|| profile.stateDirectory !== `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`
		|| profile.coordinatorRoot !== DEMO_FRIDAY_R20_COORDINATOR_ROOT
		|| profile.operatorRoot !== DEMO_FRIDAY_R20_OPERATOR_ROOT
		|| profile.exchangeDirectory !== `${DEMO_FRIDAY_R20_KEYSET_ROOT}/exchange/${DEMO_FRIDAY_R20_DKG_RUN_ID}`) {
		fail('profile differs from fixed keyset-v2 layout')
	}
	for (const [label, value] of [
		['predecessorManifestDigest', profile.predecessorManifestDigest],
		['predecessorAbortDigest', profile.predecessorAbortDigest],
		['abortAcknowledgementsDigest', profile.abortAcknowledgementsDigest],
	] as const) exactHex(value, 32, label)
	return digest('PLEBEIAN_FRIDAY_R20_FRESH_DKG_PROFILE_V2', [
		profile.valueProfile, profile.deploymentId, profile.applicationRunId, profile.dkgRunId,
		profile.committeeKeysetId, profile.committeeKeysetVersion, profile.keysetRoot,
		profile.configPath, profile.transportSecretsPath, profile.stateDirectory,
		profile.exchangeDirectory, profile.coordinatorRoot, profile.operatorRoot,
		profile.predecessorManifestDigest, profile.predecessorAbortDigest,
		profile.abortAcknowledgementsDigest,
	])
}

function exactR20Participant(value: unknown, expectedId: 1 | 2 | 3 | 4,
	predecessor: DemoFridayDkgManifestParticipantV1): DemoFridayDkgManifestParticipantV1 {
	const raw = exactObject(value, [
		'participantId', 'hostId', 'underlayIpv4', 'fipsNpub', 'fipsUla', 'dkgIdentity',
		'signerIdentity', 'kexPublicKey', 'signerEndpoint', 'participantBinarySha256',
		'inspectorBinarySha256', 'configPath', 'stateDirectory',
	], `participant ${expectedId}`)
	if (raw.participantId !== expectedId || typeof raw.hostId !== 'string' || !HOST.test(raw.hostId)
		|| raw.hostId !== predecessor.hostId || raw.underlayIpv4 !== predecessor.underlayIpv4
		|| raw.fipsNpub !== predecessor.fipsNpub || raw.fipsUla !== predecessor.fipsUla
		|| typeof raw.underlayIpv4 !== 'string' || isIP(raw.underlayIpv4) !== 4
		|| typeof raw.fipsUla !== 'string' || isIP(raw.fipsUla) !== 6
		|| typeof raw.fipsNpub !== 'string' || !NPUB.test(raw.fipsNpub)
		|| raw.signerEndpoint !== `http://[${raw.fipsUla}]:39101/v1/frost`
		|| raw.configPath !== `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`
		|| raw.stateDirectory !== `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`) fail(`participant ${expectedId} host/profile binding differs`)
	for (const field of ['dkgIdentity', 'signerIdentity', 'kexPublicKey', 'participantBinarySha256', 'inspectorBinarySha256'] as const) {
		exactHex(raw[field], 32, `participant ${expectedId} ${field}`)
	}
	for (const field of ['dkgIdentity', 'signerIdentity', 'kexPublicKey'] as const) {
		if (raw[field] === predecessor[field]) fail(`participant ${expectedId} reuses predecessor ${field}`)
	}
	try { secp256k1.Point.fromHex(`02${raw.dkgIdentity}`).assertValidity() }
	catch { fail(`participant ${expectedId} DKG identity is not on curve`) }
	try { secp256k1.Point.fromHex(`02${raw.signerIdentity}`).assertValidity() }
	catch { fail(`participant ${expectedId} signer identity is not on curve`) }
	return structuredClone(raw) as unknown as DemoFridayDkgManifestParticipantV1
}

function exactR20Manifest(value: unknown, predecessorManifest: unknown): DemoFridayDkgPublicManifestV1 {
	const predecessor = exactDemoFridayDkgManifest(predecessorManifest)
	const raw = exactObject(value, [
		'schema', 'valueProfile', 'deploymentId', 'applicationRunId', 'dkgRunId',
		'committeeKeysetId', 'committeeKeysetVersion', 'roster', 'rosterDigest',
		'coordinatorParticipantId', 'coordinatorIdentity', 'participants',
	], 'R20 manifest')
	if (raw.schema !== DEMO_FRIDAY_DKG_MANIFEST_SCHEMA || raw.valueProfile !== 'FAKE_MONEY_ONLY'
		|| raw.deploymentId !== DEMO_FRIDAY_R20_DEPLOYMENT_ID
		|| raw.applicationRunId !== DEMO_FRIDAY_R20_APPLICATION_RUN_ID
		|| raw.dkgRunId !== DEMO_FRIDAY_R20_DKG_RUN_ID || raw.committeeKeysetId !== DEMO_FRIDAY_R20_KEYSET_ID
		|| raw.committeeKeysetVersion !== DEMO_FRIDAY_R20_KEYSET_VERSION
		|| JSON.stringify(raw.roster) !== '[1,2,3,4]' || raw.coordinatorParticipantId !== 1
		|| !Array.isArray(raw.participants) || raw.participants.length !== 4) fail('R20 manifest profile differs')
	const rawParticipants = raw.participants as unknown[]
	const coordinatorIdentity = exactHex(raw.coordinatorIdentity, 32, 'coordinatorIdentity')
	if (coordinatorIdentity === predecessor.coordinatorIdentity) fail('R20 reuses predecessor coordinator identity')
	const participants = PARTICIPANTS.map((participantId, index) =>
		exactR20Participant(rawParticipants[index], participantId, predecessor.participants[index]!)) as unknown as
		DemoFridayDkgPublicManifestV1['participants']
	const authority = new Set([coordinatorIdentity])
	for (const participant of participants) {
		for (const identity of [participant.dkgIdentity, participant.signerIdentity]) {
			if (authority.has(identity)) fail('R20 manifest has duplicate Schnorr authority')
			authority.add(identity)
		}
	}
	const rosterDigest = digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ROSTER_V1',
		participants.map(participantFields))
	if (raw.rosterDigest !== rosterDigest) fail('R20 roster digest differs')
	return {
		schema: DEMO_FRIDAY_DKG_MANIFEST_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID, applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
		dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID, committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
		committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION, roster: [1, 2, 3, 4], rosterDigest,
		coordinatorParticipantId: 1, coordinatorIdentity, participants,
	}
}

function r20ManifestDigest(manifest: DemoFridayDkgPublicManifestV1): string {
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1', [
		manifest.schema, manifest.valueProfile, manifest.deploymentId, manifest.applicationRunId,
		manifest.dkgRunId, manifest.committeeKeysetId, manifest.committeeKeysetVersion,
		manifest.roster, manifest.rosterDigest, manifest.coordinatorParticipantId,
		manifest.coordinatorIdentity, manifest.participants.map(participantFields),
	])
}

function enrollmentDigest(manifest: DemoFridayDkgPublicManifestV1, manifestDigest: string, participantId: number): string {
	const participant = manifest.participants[participantId - 1]!
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ENROLLMENT_V1', [
		manifest.schema, manifest.dkgRunId, manifest.committeeKeysetId, manifest.committeeKeysetVersion,
		manifest.rosterDigest, manifestDigest, participantId, participant.dkgIdentity,
		participant.kexPublicKey, 'COCO_DEMO_FROST_DKG_ROUND2_PAIRWISE_KEY_V1',
	])
}

function verifyR20Enrollments(manifest: DemoFridayDkgPublicManifestV1, manifestDigest: string,
	values: unknown): void {
	if (!Array.isArray(values) || values.length !== 4) fail('R20 requires four enrollments')
	for (let index = 0; index < 4; index += 1) {
		const participantId = PARTICIPANTS[index]!
		const participant = manifest.participants[index]!
		const raw = exactObject(values[index], [
			'schema', 'manifestDigest', 'rosterDigest', 'participantId', 'dkgIdentity', 'signature',
		], `enrollment ${participantId}`)
		if (raw.schema !== DEMO_FRIDAY_DKG_ENROLLMENT_SCHEMA || raw.manifestDigest !== manifestDigest
			|| raw.rosterDigest !== manifest.rosterDigest || raw.participantId !== participantId
			|| raw.dkgIdentity !== participant.dkgIdentity) fail(`enrollment ${participantId} binding differs`)
		const signature = exactHex(raw.signature, 64, `enrollment ${participantId} signature`)
		if (!schnorr.verify(hexToBytes(signature), hexToBytes(enrollmentDigest(manifest, manifestDigest, participantId)),
			hexToBytes(participant.dkgIdentity))) fail(`enrollment ${participantId} signature is invalid`)
	}
}

export function exactDemoFridayR20BoundManifest(options: {
	profile: DemoFridayR20FreshDkgProfileV2
	predecessorManifest: unknown
	value: unknown
	expectedBindingDigest: string
}): DemoFridayR20BoundManifestV1 {
	const profileDigest = demoFridayR20ProfileDigest(options.profile)
	const predecessor = exactDemoFridayDkgManifest(options.predecessorManifest)
	if (demoFridayDkgManifestDigest(predecessor) !== options.profile.predecessorManifestDigest) {
		fail('predecessor manifest differs from the independently pinned abort profile')
	}
	const raw = exactObject(options.value, [
		'schema', 'profileDigest', 'predecessorAbortDigest', 'manifest', 'manifestDigest', 'bindingDigest',
	], 'bound R20 manifest')
	const manifest = exactR20Manifest(raw.manifest, predecessor)
	const manifestDigest = r20ManifestDigest(manifest)
	const bindingDigest = digest('PLEBEIAN_FRIDAY_R20_BOUND_DKG_MANIFEST_V1', [
		profileDigest, options.profile.predecessorAbortDigest, manifestDigest,
	])
	if (raw.schema !== DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA || raw.profileDigest !== profileDigest
		|| raw.predecessorAbortDigest !== options.profile.predecessorAbortDigest
		|| raw.manifestDigest !== manifestDigest || raw.bindingDigest !== bindingDigest
		|| bindingDigest !== exactHex(options.expectedBindingDigest, 32, 'expectedBindingDigest')) {
		fail('bound R20 manifest differs from the independent deployment pin')
	}
	return { schema: DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, profileDigest,
		predecessorAbortDigest: options.profile.predecessorAbortDigest, manifest,
		manifestDigest, bindingDigest }
}

export function verifyDemoFridayR20RuntimeResult(options: {
	profile: DemoFridayR20FreshDkgProfileV2
	predecessorManifest: unknown
	boundManifest: unknown
	expectedBindingDigest: string
	result: DemoFridayAuthenticatedDkgResultV2
}): DemoFridayAuthenticatedDkgResultV2 {
	const bound = exactDemoFridayR20BoundManifest({
		profile: options.profile, predecessorManifest: options.predecessorManifest,
		value: options.boundManifest, expectedBindingDigest: options.expectedBindingDigest,
	})
	return verifyDemoFridayAuthenticatedDkgResultV2AtRoot({
		expectedManifestDigest: bound.manifestDigest, result: options.result,
		expectedDkgRoot: DEMO_FRIDAY_R20_KEYSET_ROOT,
		verifyManifestAndEnrollments: ({ manifest, expectedManifestDigest, enrollments }) => {
			const checked = exactR20Manifest(manifest, options.predecessorManifest)
			if (r20ManifestDigest(checked) !== expectedManifestDigest
				|| expectedManifestDigest !== bound.manifestDigest) fail('runtime result manifest differs from bound R20 manifest')
			verifyR20Enrollments(checked, expectedManifestDigest, enrollments)
			return checked
		},
	})
}

export function demoFridayR20RuntimeBindingDigest(value: Omit<DemoFridayR20RuntimeDkgBindingV1,
	'schema' | 'bindingDigest'>): string {
	return digest(DEMO_FRIDAY_R20_RUNTIME_BINDING_SCHEMA, [
		value.valueProfile, value.deploymentId, value.applicationRunId, value.dkgRunId,
		value.committeeKeysetId, value.committeeKeysetVersion, value.dkgRoot, value.coordinatorRoot,
		value.predecessorManifestDigest, value.predecessorAbortDigest,
		value.abortAcknowledgementsDigest, value.manifestDigest,
		value.result.publicKeyPackageSha256, value.result.signerRosterDigest,
		value.result.committeePublicKey,
	])
}

/**
 * Verify the exact outer deployment record consumed by the Go application.
 * The separate manifest pin and outer binding pin are both caller supplied;
 * neither embedded digest is permitted to self-authorize the fresh run.
 */
export function verifyDemoFridayR20RuntimeBinding(options: {
	profile: DemoFridayR20FreshDkgProfileV2
	predecessorManifest: unknown
	boundManifest: unknown
	expectedManifestBindingDigest: string
	expectedRuntimeBindingDigest: string
	value: unknown
}): DemoFridayR20RuntimeDkgBindingV1 {
	const bound = exactDemoFridayR20BoundManifest({
		profile: options.profile, predecessorManifest: options.predecessorManifest,
		value: options.boundManifest, expectedBindingDigest: options.expectedManifestBindingDigest,
	})
	const raw = exactObject(options.value, [
		'schema', 'valueProfile', 'deploymentId', 'applicationRunId', 'dkgRunId',
		'committeeKeysetId', 'committeeKeysetVersion', 'dkgRoot', 'coordinatorRoot',
		'predecessorManifestDigest', 'predecessorAbortDigest', 'abortAcknowledgementsDigest',
		'manifestDigest', 'bindingDigest', 'result',
	], 'runtime DKG binding')
	if (raw.schema !== DEMO_FRIDAY_R20_RUNTIME_BINDING_SCHEMA || raw.valueProfile !== 'FAKE_MONEY_ONLY'
		|| raw.deploymentId !== options.profile.deploymentId
		|| raw.applicationRunId !== options.profile.applicationRunId || raw.dkgRunId !== options.profile.dkgRunId
		|| raw.committeeKeysetId !== options.profile.committeeKeysetId
		|| raw.committeeKeysetVersion !== options.profile.committeeKeysetVersion
		|| raw.dkgRoot !== options.profile.keysetRoot || raw.coordinatorRoot !== options.profile.coordinatorRoot
		|| raw.predecessorManifestDigest !== options.profile.predecessorManifestDigest
		|| raw.predecessorAbortDigest !== options.profile.predecessorAbortDigest
		|| raw.abortAcknowledgementsDigest !== options.profile.abortAcknowledgementsDigest
		|| raw.manifestDigest !== bound.manifestDigest) fail('runtime DKG profile differs from the fixed fresh run')
	const result = verifyDemoFridayR20RuntimeResult({
		profile: options.profile, predecessorManifest: options.predecessorManifest,
		boundManifest: options.boundManifest, expectedBindingDigest: options.expectedManifestBindingDigest,
		result: raw.result as DemoFridayAuthenticatedDkgResultV2,
	})
	const value: DemoFridayR20RuntimeDkgBindingV1 = {
		schema: DEMO_FRIDAY_R20_RUNTIME_BINDING_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: options.profile.deploymentId, applicationRunId: options.profile.applicationRunId,
		dkgRunId: options.profile.dkgRunId, committeeKeysetId: options.profile.committeeKeysetId,
		committeeKeysetVersion: options.profile.committeeKeysetVersion,
		dkgRoot: options.profile.keysetRoot, coordinatorRoot: options.profile.coordinatorRoot,
		predecessorManifestDigest: options.profile.predecessorManifestDigest,
		predecessorAbortDigest: options.profile.predecessorAbortDigest,
		abortAcknowledgementsDigest: options.profile.abortAcknowledgementsDigest,
		manifestDigest: bound.manifestDigest,
		bindingDigest: exactHex(raw.bindingDigest, 32, 'bindingDigest'), result,
	}
	const expected = exactHex(options.expectedRuntimeBindingDigest, 32, 'expectedRuntimeBindingDigest')
	if (value.bindingDigest !== expected || demoFridayR20RuntimeBindingDigest(value) !== expected) {
		fail('runtime DKG binding differs from the independent deployment pin')
	}
	return structuredClone(value)
}

export function verifyDemoFridayR20ManifestAndEnrollments(options: {
	profile: DemoFridayR20FreshDkgProfileV2
	predecessorManifest: unknown
	boundManifest: unknown
	expectedBindingDigest: string
	enrollments: unknown
}): DemoFridayDkgPublicManifestV1 {
	const bound = exactDemoFridayR20BoundManifest({
		profile: options.profile, predecessorManifest: options.predecessorManifest,
		value: options.boundManifest, expectedBindingDigest: options.expectedBindingDigest,
	})
	verifyR20Enrollments(bound.manifest, bound.manifestDigest, options.enrollments)
	return structuredClone(bound.manifest)
}
