/** Exact fresh-run signer boundary. No I/O is performed in this module. */
import { bytesToHex } from '@noble/hashes/utils.js'
import { join } from 'node:path'

import {
	verifyDemoFridayR20RuntimeBinding,
	type DemoFridayR20RuntimeDkgBindingV1,
} from './demo-friday-r20-enrollment-runtime'
import type { DemoFridayR20FreshDkgProfileV2 } from './demo-friday-r20-fresh-profile'
import {
	exactDemoFridayStatePath,
	type DemoFridayLiveApplicationV3,
} from './demo-friday-runtime-config'
import {
	exactDemoFridaySignerNetworkFactsV1,
	type DemoFridaySignerNetworkFactsV1,
} from './demo-friday-signer-dkg-v2'
import type { DemoFridayAuthenticatedDkgParticipantV2 } from './demo-friday-per-validator-dkg-bootstrap-v2'

export interface DemoFridaySignerDkgBindingR20 {
	runtime: DemoFridayR20RuntimeDkgBindingV1
	target: DemoFridayAuthenticatedDkgParticipantV2
	facts: DemoFridaySignerNetworkFactsV1
	publicKeyPackagePath: string
	configPath: string
	stateDirectory: string
}

export function bindDemoFridaySignerDkgR20(options: {
	application: DemoFridayLiveApplicationV3
	profile: DemoFridayR20FreshDkgProfileV2
	predecessorManifest: unknown
	boundManifest: unknown
	expectedManifestBindingDigest: string
	expectedRuntimeBindingDigest: string
	runtimeBinding: unknown
	networkFacts: unknown
	slot: 1 | 2 | 3 | 4
}): DemoFridaySignerDkgBindingR20 {
	if (options.application.schema !== 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3'
		|| options.application.deployment_id !== options.profile.deploymentId
		|| options.application.run_id !== options.profile.applicationRunId
		|| options.application.dkg_root !== options.profile.keysetRoot
		|| options.application.coordinator_root !== options.profile.coordinatorRoot
		|| options.application.application_host_slot !== options.slot) {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_R20: application differs from the fixed fresh-run profile or local slot')
	}
	const runtime = verifyDemoFridayR20RuntimeBinding({
		profile: options.profile, predecessorManifest: options.predecessorManifest,
		boundManifest: options.boundManifest,
		expectedManifestBindingDigest: options.expectedManifestBindingDigest,
		expectedRuntimeBindingDigest: options.expectedRuntimeBindingDigest,
		value: options.runtimeBinding,
	})
	const facts = exactDemoFridaySignerNetworkFactsV1(options.networkFacts)
	if (runtime.result.committeePublicKey !== facts.committee_public_key) {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_R20: authenticated committee differs from network facts')
	}
	for (let index = 0; index < 4; index += 1) {
		const participant = runtime.result.participants[index]!
		const ula = options.application.fips_ulas[index]
		if (participant.participantId !== index + 1 || participant.fipsUla !== ula
			|| participant.signerEndpoint !== `http://[${ula}]:${options.application.signer_rpc_port}/v1/frost`) {
			throw new Error('DEMO_FRIDAY_SIGNER_DKG_R20: authenticated FIPS signer roster differs from the application')
		}
	}
	const publicKeyPackagePath = exactDemoFridayStatePath(options.application,
		runtime.result.publicKeyPackagePath, 'R20 public key package')
	if (publicKeyPackagePath !== join(options.profile.exchangeDirectory, 'participant-1.public.json')) {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_R20: public package path differs from the fresh ceremony layout')
	}
	const target = runtime.result.participants[options.slot - 1]
	if (target === undefined || target.participantId !== options.slot) {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_R20: authenticated result lacks the local signer')
	}
	const configPath = exactDemoFridayStatePath(options.application, target.configPath, 'R20 participant config')
	const stateDirectory = exactDemoFridayStatePath(options.application, target.stateDirectory, 'R20 participant state')
	if (configPath !== options.profile.configPath || stateDirectory !== options.profile.stateDirectory) {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_R20: local private paths differ from the fixed fresh ceremony layout')
	}
	return { runtime, target, facts, publicKeyPackagePath, configPath, stateDirectory }
}

export function assertDemoFridayR20PublicPackageBytes(
	binding: DemoFridaySignerDkgBindingR20,
	raw: Uint8Array,
): void {
	if (raw.length === 0 || raw.length > 65_536 || bytesToHex(raw) !== binding.runtime.result.publicKeyPackageHex) {
		throw new Error('DEMO_FRIDAY_SIGNER_DKG_R20: installed public package bytes differ from the authenticated result')
	}
}
