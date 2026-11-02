import { describe, expect, test } from 'bun:test'

import { exactDemoFridayApplication } from './demo-friday-runtime-config'
import {
	demoFridayR20ServicePaths, demoFridayR20ServicePins,
	requireDemoFridayR20InstalledManifestInputs,
	requireDemoFridayR20ServicePredecessorSeal,
} from './demo-friday-r20-service-binding'

const parsed = exactDemoFridayApplication({
	schema: 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3', deployment_id: 'friday-demo-20261023-r20',
	run_id: 'friday-demo-20261023-r20-run1', application_host_slot: 2,
	fips_ulas: ['fd42::1', 'fd42::2', 'fd42::3', 'fd42::4'],
	comet_p2p_port: 27656, comet_rpc_port: 27657, signer_rpc_port: 39101,
	mint_port: 3438, cashu_mint_url: 'https://172.105.95.57', site_port: 8180,
	network_root: '/var/lib/plebeian-auctions-friday/network-r20',
	dkg_root: '/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2',
	coordinator_root: '/var/lib/plebeian-auctions-friday/coordinator-v2',
	coordinator_rpc_identity_path: '/var/lib/plebeian-auctions-friday/coordinator-v2/coordinator-rpc-identity.key',
})
if (parsed.schema !== 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3') throw new Error('R20 application did not narrow')

describe('Friday R20 service binding contract', () => {
	test('uses fixed pre-enrollment inputs and post-enrollment keyset artifacts', () => {
		expect(demoFridayR20ServicePaths(parsed)).toEqual({
			profile: '/var/lib/plebeian-auctions-friday/frost-v2/r20-inputs/fresh-profile.json',
			predecessorManifest: '/var/lib/plebeian-auctions-friday/frost-v2/r20-inputs/predecessor-manifest.json',
			manifest: '/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2/manifest.json',
			manifestDigest: '/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2/owner-approved-manifest-digest.txt',
			boundManifest: '/var/lib/plebeian-auctions-friday/frost-v2/r20-inputs/bound-manifest.json',
			runtimeBinding: '/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2/runtime-binding.json',
			publicKeyPackage: '/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2/exchange/friday-demo-20261023-r20-dkg2/participant-1.public.json',
		})
	})

	test('requires two independently supplied exact digest pins', () => {
		expect(demoFridayR20ServicePins({
			FRIDAY_R20_MANIFEST_BINDING_DIGEST: '11'.repeat(32),
			FRIDAY_R20_RUNTIME_BINDING_DIGEST: '22'.repeat(32),
		})).toEqual({ manifestBindingDigest: '11'.repeat(32), runtimeBindingDigest: '22'.repeat(32) })
		expect(() => demoFridayR20ServicePins({ FRIDAY_R20_MANIFEST_BINDING_DIGEST: '11'.repeat(32) })).toThrow()
		expect(() => demoFridayR20ServicePins({
			FRIDAY_R20_MANIFEST_BINDING_DIGEST: '11'.repeat(32), FRIDAY_R20_RUNTIME_BINDING_DIGEST: 'GG',
		})).toThrow()
	})

	test('requires the service-owned manifest and exact 64-hex-plus-newline pin', () => {
		const manifest = { schema: 'manifest', roster: [1, 2, 3, 4] }
		const runtime = { manifestDigest: '11'.repeat(32), result: { manifest } }
		expect(() => requireDemoFridayR20InstalledManifestInputs({
			manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
			manifestDigestBytes: new TextEncoder().encode(`${runtime.manifestDigest}\n`), runtime,
		})).not.toThrow()
		for (const manifestDigestBytes of [
			new TextEncoder().encode(runtime.manifestDigest),
			new TextEncoder().encode(`${runtime.manifestDigest}\n\n`),
			new TextEncoder().encode(`${'22'.repeat(32)}\n`),
		]) {
			expect(() => requireDemoFridayR20InstalledManifestInputs({
				manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)), manifestDigestBytes, runtime,
			})).toThrow()
		}
		expect(() => requireDemoFridayR20InstalledManifestInputs({
			manifestBytes: new TextEncoder().encode(JSON.stringify({ ...manifest, roster: [1] })),
			manifestDigestBytes: new TextEncoder().encode(`${runtime.manifestDigest}\n`), runtime,
		})).toThrow()
	})

	test('requires the exact local predecessor seal before service state', async () => {
		let observed: unknown
		await requireDemoFridayR20ServicePredecessorSeal({ application: parsed,
			runtime: { predecessorAbortDigest: '33'.repeat(32), predecessorManifestDigest: '44'.repeat(32) },
			verify: async (value) => { observed = value; return {} as any },
		})
		expect(observed).toEqual({ expectedAbortDigest: '33'.repeat(32),
			expectedManifestDigest: '44'.repeat(32), expectedParticipantId: 2 })
		await expect(requireDemoFridayR20ServicePredecessorSeal({ application: parsed,
			runtime: { predecessorAbortDigest: '33'.repeat(32), predecessorManifestDigest: '44'.repeat(32) },
			verify: async () => { throw new Error('permission seal missing') },
		})).rejects.toThrow('permission seal missing')
	})
})
