import { describe, expect, test } from 'bun:test'
import {
	demoFridayLoopbackRpc, demoFridayMintIdentityUrl, demoFridayMintUrl, demoFridayNodeRoot, exactDemoFridayApplication,
	exactDemoFridayApplicationInputPath, exactDemoFridayCoordinatorAnchorPath,
	exactDemoFridayPublicInputPath, exactDemoFridayStatePath,
} from './demo-friday-runtime-config'

const live = {
	schema: 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2', deployment_id: 'friday-blue-20261023', run_id: 'dkg-friday-blue-1',
	application_host_slot: 2,
	fips_ulas: ['fd42::1', 'fd42::2', 'fd42::3', 'fd42::4'], comet_p2p_port: 27656,
	comet_rpc_port: 27657, signer_rpc_port: 39101, mint_port: 3438, site_port: 8180,
	cashu_mint_url: 'https://172.105.95.57',
	network_root: '/var/lib/plebeian-auctions-friday/network', dkg_root: '/var/lib/plebeian-auctions-friday/frost/keyset-v1',
	coordinator_root: '/var/lib/plebeian-auctions-friday/coordinator',
	coordinator_rpc_identity_path: '/var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.key',
} as const

const r20 = {
	...live,
	schema: 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3',
	deployment_id: 'friday-demo-20261023-r20',
	run_id: 'friday-demo-20261023-r20-run1',
	network_root: '/var/lib/plebeian-auctions-friday/network-r20',
	dkg_root: '/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2',
	coordinator_root: '/var/lib/plebeian-auctions-friday/coordinator-v2',
	coordinator_rpc_identity_path: '/var/lib/plebeian-auctions-friday/coordinator-v2/coordinator-rpc-identity.key',
} as const

describe('Friday live configuration boundary', () => {
	test('accepts only the non-conflicting blue/green topology', () => {
		const value = exactDemoFridayApplication(live)
		expect(demoFridayNodeRoot(value, 3)).toBe('/var/lib/plebeian-auctions-friday/frost/node-3')
		expect(demoFridayLoopbackRpc(value)).toBe('http://127.0.0.1:27657')
		expect(demoFridayMintUrl(value)).toBe('http://[fd42::2]:3438')
		expect(demoFridayMintIdentityUrl(value)).toBe('https://172.105.95.57')
		expect(value.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2' && value.coordinator_rpc_identity_path)
			.toBe('/var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.key')
		expect(exactDemoFridayApplicationInputPath('/etc/plebeian-auctions-friday/application.json')).toBe('/etc/plebeian-auctions-friday/application.json')
		expect(exactDemoFridayPublicInputPath('/var/lib/plebeian-auctions-friday/frost/public/dkg-result.json', 'dkg')).toContain('/frost/public/')
		expect(exactDemoFridayStatePath(value, '/var/lib/plebeian-auctions-friday/frost/node-1/journal.sqlite3', 'journal')).toContain('/node-1/')
		expect(exactDemoFridayCoordinatorAnchorPath(value, '/var/lib/plebeian-auctions-friday-anchor/coordinator.sqlite3'))
			.toContain('friday-anchor')
	})

	test('rejects Wednesday roots, public app ports, duplicate ULAs and extra fields', () => {
		expect(() => exactDemoFridayApplication({ ...live, network_root: '/var/lib/plebeian-auctions-poc/network' })).toThrow()
		expect(() => exactDemoFridayApplication({ ...live, signer_rpc_port: 443 })).toThrow()
		expect(() => exactDemoFridayApplication({ ...live, fips_ulas: ['fd42::1', 'fd42::1', 'fd42::3', 'fd42::4'] })).toThrow()
		expect(() => exactDemoFridayApplication({ ...live, production: true })).toThrow()
		expect(() => exactDemoFridayApplication({ ...live, application_host_slot: 5 })).toThrow()
		expect(() => exactDemoFridayApplication({ ...live, cashu_mint_url: 'http://[fd42::1]:3438' })).toThrow()
		expect(() => exactDemoFridayApplication({ ...live, coordinator_rpc_identity_path: '/tmp/node-1/coordinator-rpc-identity.key' })).toThrow()
		expect(() => exactDemoFridayApplicationInputPath('/etc/plebeian-auctions-poc/application.json')).toThrow()
		expect(() => exactDemoFridayPublicInputPath('/var/lib/plebeian-auctions-poc/network/genesis.json', 'facts')).toThrow()
		expect(() => exactDemoFridayCoordinatorAnchorPath(exactDemoFridayApplication(live), '/var/lib/plebeian-auctions-friday/coordinator/anchor.sqlite3')).toThrow()
	})

	test('accepts only the fixed fresh R20 keyset and rejects V2/R20 cross-use', () => {
		const value = exactDemoFridayApplication(r20)
		expect(value.schema).toBe('PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3')
		if (value.schema !== 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3') throw new Error('R20 schema narrowed incorrectly')
		expect(value.dkg_root).toBe('/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2')
		expect(value.network_root).toBe('/var/lib/plebeian-auctions-friday/network-r20')
		expect(value.coordinator_root).toBe('/var/lib/plebeian-auctions-friday/coordinator-v2')
		expect(demoFridayNodeRoot(value, 2)).toBe('/var/lib/plebeian-auctions-friday/r20/node-2')
		expect(exactDemoFridayCoordinatorAnchorPath(value,
			'/var/lib/plebeian-auctions-friday-anchor-r20/coordinator.sqlite3')).toContain('anchor-r20')
		expect(() => exactDemoFridayCoordinatorAnchorPath(value,
			'/var/lib/plebeian-auctions-friday-anchor/coordinator.sqlite3')).toThrow('anchor path differs')
		expect(() => exactDemoFridayApplication({ ...r20,
			dkg_root: '/var/lib/plebeian-auctions-friday/frost/keyset-v1' })).toThrow('R20 roots')
		expect(() => exactDemoFridayApplication({ ...r20,
			deployment_id: live.deployment_id })).toThrow('R20 roots')
		expect(() => exactDemoFridayApplication({ ...live,
			dkg_root: '/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2' })).toThrow('live roots')
	})
})
