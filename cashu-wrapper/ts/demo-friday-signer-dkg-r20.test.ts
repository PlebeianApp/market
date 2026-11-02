import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, demoFridayR20ProfileDigest,
	type DemoFridayR20RuntimeDkgBindingV1,
} from './demo-friday-r20-enrollment-runtime'
import {
	DEMO_FRIDAY_R20_APPLICATION_RUN_ID, DEMO_FRIDAY_R20_COORDINATOR_ROOT,
	DEMO_FRIDAY_R20_DEPLOYMENT_ID, DEMO_FRIDAY_R20_DKG_RUN_ID,
	DEMO_FRIDAY_R20_KEYSET_ID, DEMO_FRIDAY_R20_KEYSET_ROOT,
	DEMO_FRIDAY_R20_KEYSET_VERSION, DEMO_FRIDAY_R20_OPERATOR_ROOT,
	type DemoFridayR20FreshDkgProfileV2,
} from './demo-friday-r20-fresh-profile'
import { exactDemoFridayApplication } from './demo-friday-runtime-config'
import { assertDemoFridayR20PublicPackageBytes, bindDemoFridaySignerDkgR20 } from './demo-friday-signer-dkg-r20'

const golden = await Bun.file(new URL(
	'../../internal/poc/testdata/friday-r20-runtime-binding-go-golden.json', import.meta.url,
)).json() as { predecessorManifest: unknown; binding: DemoFridayR20RuntimeDkgBindingV1 }
const runtime = golden.binding
const profile: DemoFridayR20FreshDkgProfileV2 = {
	schema: 'PLEBEIAN_FRIDAY_FRESH_DKG_PROFILE_V2', valueProfile: 'FAKE_MONEY_ONLY',
	deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID, applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
	dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID, committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
	committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION, keysetRoot: DEMO_FRIDAY_R20_KEYSET_ROOT,
	configPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`,
	transportSecretsPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/transport-secrets.json`,
	stateDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`,
	exchangeDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/exchange/${DEMO_FRIDAY_R20_DKG_RUN_ID}`,
	coordinatorRoot: DEMO_FRIDAY_R20_COORDINATOR_ROOT, operatorRoot: DEMO_FRIDAY_R20_OPERATOR_ROOT,
	predecessorManifestDigest: runtime.predecessorManifestDigest,
	predecessorAbortDigest: runtime.predecessorAbortDigest,
	abortAcknowledgementsDigest: runtime.abortAcknowledgementsDigest,
}
const profileDigest = demoFridayR20ProfileDigest(profile)
const manifestBindingDigest = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
	DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, profileDigest, profile.predecessorAbortDigest, runtime.manifestDigest,
]))))
const boundManifest = {
	schema: DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, profileDigest,
	predecessorAbortDigest: profile.predecessorAbortDigest, manifest: runtime.result.manifest,
	manifestDigest: runtime.manifestDigest, bindingDigest: manifestBindingDigest,
}
const parsedApplication = exactDemoFridayApplication({
	schema: 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3', deployment_id: DEMO_FRIDAY_R20_DEPLOYMENT_ID,
	run_id: DEMO_FRIDAY_R20_APPLICATION_RUN_ID, application_host_slot: 2,
	fips_ulas: runtime.result.participants.map((participant) => participant.fipsUla),
	comet_p2p_port: 27656, comet_rpc_port: 27657, signer_rpc_port: 39101,
	mint_port: 3438, cashu_mint_url: 'https://172.105.95.57', site_port: 8180,
	network_root: '/var/lib/plebeian-auctions-friday/network-r20', dkg_root: DEMO_FRIDAY_R20_KEYSET_ROOT,
	coordinator_root: DEMO_FRIDAY_R20_COORDINATOR_ROOT,
	coordinator_rpc_identity_path: `${DEMO_FRIDAY_R20_COORDINATOR_ROOT}/coordinator-rpc-identity.key`,
})
if (parsedApplication.schema !== 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3') throw new Error('R20 application did not narrow')
const application = parsedApplication
const facts = {
	schema: 'PlebeianAuctionsPOCNetworkFactsV1', chain_id: 'plebeian-friday-r20',
	genesis_sha256: '11'.repeat(32), validators_hash: '22'.repeat(32),
	committee_public_key: runtime.result.committeePublicKey, validator_roster_version: 'genesis-v1',
}

function bind() {
	return bindDemoFridaySignerDkgR20({
		application, profile, predecessorManifest: golden.predecessorManifest, boundManifest,
		expectedManifestBindingDigest: manifestBindingDigest,
		expectedRuntimeBindingDigest: runtime.bindingDigest, runtimeBinding: runtime,
		networkFacts: facts, slot: 2,
	})
}

describe('Friday R20 signer binding', () => {
	test('binds the fresh application, Go result, committee, slot and local paths', () => {
		const binding = bind()
		expect(binding.configPath).toBe(`${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`)
		expect(binding.stateDirectory).toBe(`${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`)
		expect(binding.publicKeyPackagePath).toBe(
			`${DEMO_FRIDAY_R20_KEYSET_ROOT}/exchange/${DEMO_FRIDAY_R20_DKG_RUN_ID}/participant-1.public.json`)
		expect(() => assertDemoFridayR20PublicPackageBytes(binding,
			Buffer.from(runtime.result.publicKeyPackageHex, 'hex'))).not.toThrow()
	})

	test('rejects cross-run applications, outer pins, local slots and committee substitution', () => {
		expect(() => bindDemoFridaySignerDkgR20({
			application: { ...application, dkg_root: '/var/lib/plebeian-auctions-friday/frost/keyset-v1' } as any,
			profile, predecessorManifest: golden.predecessorManifest, boundManifest,
			expectedManifestBindingDigest: manifestBindingDigest,
			expectedRuntimeBindingDigest: runtime.bindingDigest, runtimeBinding: runtime,
			networkFacts: facts, slot: 2,
		})).toThrow('fixed fresh-run profile')
		expect(() => bindDemoFridaySignerDkgR20({
			application, profile, predecessorManifest: golden.predecessorManifest, boundManifest,
			expectedManifestBindingDigest: manifestBindingDigest,
			expectedRuntimeBindingDigest: '00'.repeat(32), runtimeBinding: runtime,
			networkFacts: facts, slot: 2,
		})).toThrow('independent deployment pin')
		expect(() => bindDemoFridaySignerDkgR20({
			application, profile, predecessorManifest: golden.predecessorManifest, boundManifest,
			expectedManifestBindingDigest: manifestBindingDigest,
			expectedRuntimeBindingDigest: runtime.bindingDigest, runtimeBinding: runtime,
			networkFacts: facts, slot: 1,
		})).toThrow('local slot')
		expect(() => bindDemoFridaySignerDkgR20({
			application, profile, predecessorManifest: golden.predecessorManifest, boundManifest,
			expectedManifestBindingDigest: manifestBindingDigest,
			expectedRuntimeBindingDigest: runtime.bindingDigest, runtimeBinding: runtime,
			networkFacts: { ...facts, committee_public_key: `02${'44'.repeat(32)}` }, slot: 2,
		})).toThrow('committee')
	})
})
