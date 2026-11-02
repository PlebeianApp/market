import { describe, expect, test } from 'bun:test'

import { exactDemoFridayApplication } from './demo-friday-runtime-config'
import {
	assertDemoFridayPublicPackageBytes,
	bindDemoFridaySignerDkgV2,
} from './demo-friday-signer-dkg-v2'

const goldenPath = new URL('../../internal/poc/testdata/friday-authenticated-dkg-v2-typescript-golden.json', import.meta.url)
const golden = await Bun.file(goldenPath).json() as Record<string, unknown>
const digest = golden.manifestDigest as string
const committee = golden.committeePublicKey as string
const application = exactDemoFridayApplication({
	schema: 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2',
	deployment_id: 'friday-cross-language-golden',
	run_id: 'friday-cross-language-run',
	application_host_slot: 2,
	fips_ulas: ['fd42::1', 'fd42::2', 'fd42::3', 'fd42::4'],
	comet_p2p_port: 27656,
	comet_rpc_port: 27657,
	signer_rpc_port: 39101,
	mint_port: 3438,
	cashu_mint_url: 'https://172.105.95.57',
	site_port: 8180,
	network_root: '/var/lib/plebeian-auctions-friday/network',
	dkg_root: '/var/lib/plebeian-auctions-friday/frost/keyset-v1',
	coordinator_root: '/var/lib/plebeian-auctions-friday/coordinator',
	coordinator_rpc_identity_path: '/var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.key',
})
const facts = {
	schema: 'PlebeianAuctionsPOCNetworkFactsV1',
	chain_id: 'plebeian-friday-cross-language',
	genesis_sha256: '11'.repeat(32),
	validators_hash: '22'.repeat(32),
	committee_public_key: committee,
	validator_roster_version: 'genesis-v1',
}

function clone<T>(value: T): T { return structuredClone(value) }

describe('authenticated Friday signer DKG V2 consumer', () => {
	test('binds the external pin, V2 result, application, local slot, and installed package bytes', () => {
		const binding = bindDemoFridaySignerDkgV2({
			application, expectedManifestDigest: digest, dkgResult: golden, networkFacts: facts, slot: 2,
		})
		expect(binding.configPath).toBe('/var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json')
		expect(binding.stateDirectory).toBe('/var/lib/plebeian-auctions-friday/frost/keyset-v1/state')
		expect(binding.publicKeyPackagePath).toContain('/exchange/friday-cross-language-dkg/participant-1.public.json')
		expect(() => assertDemoFridayPublicPackageBytes(binding,
			Buffer.from(golden.publicKeyPackageHex as string, 'hex'))).not.toThrow()
		expect(() => assertDemoFridayPublicPackageBytes(binding, new Uint8Array([1]))).toThrow('installed public package')
	})

	test('rejects a self-pinned, legacy, wrong-slot, wrong-committee, or alternate-path result', () => {
		expect(() => bindDemoFridaySignerDkgV2({ application, expectedManifestDigest: '00'.repeat(32),
			dkgResult: golden, networkFacts: facts, slot: 2 })).toThrow('external manifest binding')
		expect(() => bindDemoFridaySignerDkgV2({ application, expectedManifestDigest: digest,
			dkgResult: { schema: 'PLEBEIAN_FRIDAY_FIPS_DKG_RESULT_V1' }, networkFacts: facts, slot: 2 })).toThrow()
		expect(() => bindDemoFridaySignerDkgV2({ application, expectedManifestDigest: digest,
			dkgResult: golden, networkFacts: facts, slot: 1 })).toThrow('local signer slot')
		expect(() => bindDemoFridaySignerDkgV2({ application, expectedManifestDigest: digest,
			dkgResult: golden, networkFacts: { ...facts, committee_public_key: `02${'44'.repeat(32)}` }, slot: 2 })).toThrow('committee')
		const alternate = clone(golden)
		alternate.publicKeyPackagePath = '/var/lib/plebeian-auctions-friday/frost/keyset-v1/participant-1.public.json'
		expect(() => bindDemoFridaySignerDkgV2({ application, expectedManifestDigest: digest,
			dkgResult: alternate, networkFacts: facts, slot: 2 })).toThrow()
	})

	test('rejects extra network fields and mismatched authenticated FIPS endpoints', () => {
		expect(() => bindDemoFridaySignerDkgV2({ application, expectedManifestDigest: digest,
			dkgResult: golden, networkFacts: { ...facts, extra: true }, slot: 2 })).toThrow('missing or unexpected')
		const otherApplication = exactDemoFridayApplication({ ...application,
			fips_ulas: ['fd42::1', 'fd42::20', 'fd42::3', 'fd42::4'] })
		expect(() => bindDemoFridaySignerDkgV2({ application: otherApplication, expectedManifestDigest: digest,
			dkgResult: golden, networkFacts: facts, slot: 2 })).toThrow('authenticated FIPS signer roster')
	})

	test('rejects the fresh R20 application before legacy verification', () => {
		const r20 = exactDemoFridayApplication({
			...application, schema: 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3',
			deployment_id: 'friday-demo-20261023-r20', run_id: 'friday-demo-20261023-r20-run1',
			network_root: '/var/lib/plebeian-auctions-friday/network-r20',
			dkg_root: '/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2',
			coordinator_root: '/var/lib/plebeian-auctions-friday/coordinator-v2',
			coordinator_rpc_identity_path: '/var/lib/plebeian-auctions-friday/coordinator-v2/coordinator-rpc-identity.key',
		})
		expect(() => bindDemoFridaySignerDkgV2({ application: r20,
			expectedManifestDigest: digest, dkgResult: golden, networkFacts: facts, slot: 2 }))
			.toThrow('fresh-run verifier')
	})
})
