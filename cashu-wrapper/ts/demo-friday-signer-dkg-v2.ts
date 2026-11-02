import { bytesToHex } from '@noble/hashes/utils.js'
import { join } from 'node:path'

import {
	verifyDemoFridayAuthenticatedDkgResultV2,
	type DemoFridayAuthenticatedDkgParticipantV2,
	type DemoFridayAuthenticatedDkgResultV2,
} from './demo-friday-per-validator-dkg-bootstrap-v2'
import {
	exactDemoFridayStatePath, isSeparatedApplication,
	type DemoFridayApplication,
} from './demo-friday-runtime-config'

const HEX_32 = /^[0-9a-f]{64}$/
const CHAIN_ID = /^[a-z0-9._-]{1,50}$/

export interface DemoFridaySignerNetworkFactsV1 {
	schema: 'PlebeianAuctionsPOCNetworkFactsV1'
	chain_id: string
	genesis_sha256: string
	validators_hash: string
	committee_public_key: string
	validator_roster_version: 'genesis-v1'
}

export interface DemoFridaySignerDkgBindingV2 {
	result: DemoFridayAuthenticatedDkgResultV2
	target: DemoFridayAuthenticatedDkgParticipantV2
	facts: DemoFridaySignerNetworkFactsV1
	publicKeyPackagePath: string
	configPath: string
	stateDirectory: string
}

export type DemoFridayPublicDkgBindingV2 = Omit<DemoFridaySignerDkgBindingV2,
	'target' | 'configPath' | 'stateDirectory'>

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new Error(`DEMO_FRIDAY_SIGNER_DKG_V2: ${label} has missing or unexpected fields`)
	}
	return value as Record<string, unknown>
}

export function exactDemoFridaySignerNetworkFactsV1(value: unknown): DemoFridaySignerNetworkFactsV1 {
	const raw = exactObject(value, [
		'schema', 'chain_id', 'genesis_sha256', 'validators_hash', 'committee_public_key',
		'validator_roster_version',
	], 'network facts')
	if (raw.schema !== 'PlebeianAuctionsPOCNetworkFactsV1'
		|| typeof raw.chain_id !== 'string' || !CHAIN_ID.test(raw.chain_id)
		|| typeof raw.genesis_sha256 !== 'string' || !HEX_32.test(raw.genesis_sha256)
		|| typeof raw.validators_hash !== 'string' || !HEX_32.test(raw.validators_hash)
		|| typeof raw.committee_public_key !== 'string' || !/^(?:02)[0-9a-f]{64}$/.test(raw.committee_public_key)
		|| raw.validator_roster_version !== 'genesis-v1') {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_V2: network facts are malformed')
	}
	return structuredClone(value) as DemoFridaySignerNetworkFactsV1
}

/** Verify the externally pinned public DKG authority shared by every service. */
export function verifyDemoFridayPublicDkgV2(options: {
	application: DemoFridayApplication
	expectedManifestDigest: string
	dkgResult: unknown
	networkFacts: unknown
}): DemoFridayPublicDkgBindingV2 {
	if (isSeparatedApplication(options.application) || options.application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3') {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_V2: R20 application requires the fresh-run verifier')
	}
	if (!HEX_32.test(options.expectedManifestDigest)) {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_V2: external manifest digest pin is malformed')
	}
	const result = verifyDemoFridayAuthenticatedDkgResultV2({
		expectedManifestDigest: options.expectedManifestDigest,
		result: options.dkgResult as DemoFridayAuthenticatedDkgResultV2,
	})
	const facts = exactDemoFridaySignerNetworkFactsV1(options.networkFacts)
	if (result.runId !== options.application.run_id
		|| (options.application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
			&& result.manifest.deploymentId !== options.application.deployment_id)
		|| result.committeePublicKey !== facts.committee_public_key) {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_V2: application, committee, or deployment binding differs')
	}
	for (let index = 0; index < 4; index += 1) {
		const participant = result.participants[index]!
		if (participant.participantId !== index + 1
			|| participant.fipsUla !== options.application.fips_ulas[index]
			|| participant.signerEndpoint !== `http://[${options.application.fips_ulas[index]}]:${options.application.signer_rpc_port}/v1/frost`) {
			throw new Error('DEMO_FRIDAY_SIGNER_DKG_V2: authenticated FIPS signer roster differs from the application')
		}
	}
	const publicKeyPackagePath = exactDemoFridayStatePath(options.application,
		result.publicKeyPackagePath, 'public key package')
	if (publicKeyPackagePath !== join(options.application.dkg_root, 'exchange', result.dkgRunId, 'participant-1.public.json')) {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_V2: public package path differs from the fixed ceremony layout')
	}
	return { result, facts, publicKeyPackagePath }
}

/** Bind one signer to its sole local private state after public verification. */
export function bindDemoFridaySignerDkgV2(options: {
	application: DemoFridayApplication
	expectedManifestDigest: string
	dkgResult: unknown
	networkFacts: unknown
	slot: 1 | 2 | 3 | 4
}): DemoFridaySignerDkgBindingV2 {
	const verified = verifyDemoFridayPublicDkgV2(options)
	const target = verified.result.participants[options.slot - 1]
	if (target === undefined || target.participantId !== options.slot
		|| (options.application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
			&& options.application.application_host_slot !== options.slot)) {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_V2: application and local signer slot differ')
	}
	const configPath = exactDemoFridayStatePath(options.application, target.configPath, 'local participant config')
	const stateDirectory = exactDemoFridayStatePath(options.application, target.stateDirectory, 'local participant state')
	if (configPath !== join(options.application.dkg_root, 'participant.config.json')
		|| stateDirectory !== join(options.application.dkg_root, 'state')) {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_V2: local private paths differ from the fixed ceremony layout')
	}
	return { ...verified, target, configPath, stateDirectory }
}

export function assertDemoFridayPublicPackageBytes(
	binding: DemoFridayPublicDkgBindingV2,
	raw: Uint8Array,
): void {
	if (raw.length === 0 || raw.length > 65_536 || bytesToHex(raw) !== binding.result.publicKeyPackageHex) {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_V2: installed public package bytes differ from the authenticated result')
	}
}
