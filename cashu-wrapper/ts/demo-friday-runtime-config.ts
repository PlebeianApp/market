/**
 * Shared, fail-closed configuration boundary for the isolated lab and the
 * separate Friday blue/green candidate.
 *
 * The live schema deliberately does not accept arbitrary roots or ports.  A
 * reviewed deployment may substitute identities and ULA addresses, but it
 * cannot redirect signer state into the Wednesday tree or expose an
 * application/RPC listener by changing JSON alone.
 */
import { isIP } from 'node:net'
import { resolve } from 'node:path'
import { SEPARATED_DEPLOYMENT_ID, SEPARATED_APPLICATION_RUN_ID, SEPARATED_PUBLIC_ORIGIN } from './demo-friday-separated-constants'

const LAB_PREFIX = '/tmp/plebeian-friday-fips-lab.'
export const FRIDAY_LIVE_STATE_ROOT = '/var/lib/plebeian-auctions-friday'
export const FRIDAY_LIVE_CONFIG_ROOT = '/etc/plebeian-auctions-friday'
export const FRIDAY_LIVE_COORDINATOR_ANCHOR = '/var/lib/plebeian-auctions-friday-anchor/coordinator.sqlite3'
export const FRIDAY_LIVE_FUNDING_REPLAY_ANCHOR = '/var/lib/plebeian-auctions-friday-anchor/funding-replay.sqlite3'
export const FRIDAY_LIVE_FUNDING_BROADCAST_ANCHOR = '/var/lib/plebeian-auctions-friday-anchor/funding-broadcast.sqlite3'
export const FRIDAY_LIVE_FUNDING_ABORT_ANCHOR = '/var/lib/plebeian-auctions-friday-anchor/funding-abort.sqlite3'
export const FRIDAY_LIVE_SELLER_PLAN_ANCHOR = '/var/lib/plebeian-auctions-friday-anchor/seller-plan.sqlite3'
export const FRIDAY_R20_ANCHOR_ROOT = '/var/lib/plebeian-auctions-friday-anchor-r20'
export const FRIDAY_R20_COORDINATOR_ANCHOR = `${FRIDAY_R20_ANCHOR_ROOT}/coordinator.sqlite3`
export const FRIDAY_R20_FUNDING_REPLAY_ANCHOR = `${FRIDAY_R20_ANCHOR_ROOT}/funding-replay.sqlite3`
export const FRIDAY_R20_FUNDING_BROADCAST_ANCHOR = `${FRIDAY_R20_ANCHOR_ROOT}/funding-broadcast.sqlite3`
export const FRIDAY_R20_FUNDING_ABORT_ANCHOR = `${FRIDAY_R20_ANCHOR_ROOT}/funding-abort.sqlite3`
export const FRIDAY_R20_SELLER_PLAN_ANCHOR = `${FRIDAY_R20_ANCHOR_ROOT}/seller-plan.sqlite3`

type FourStrings = [string, string, string, string]

export interface DemoFridayLabApplicationV2 {
	schema: 'PLEBEIAN_FRIDAY_FIPS_LAB_APPLICATION_V2'
	run_id: string
	fips_ulas: FourStrings
	comet_p2p_port: 26656
	comet_rpc_port: 26657
	signer_rpc_port: 39101
	mint_port: 3338
	network_root: string
	dkg_root: string
	driver_result: string
}

export interface DemoFridayLiveApplicationV2 {
	schema: 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
	deployment_id: string
	run_id: string
	application_host_slot: 1 | 2 | 3 | 4
	fips_ulas: FourStrings
	comet_p2p_port: 27656
	comet_rpc_port: 27657
	signer_rpc_port: 39101
	mint_port: 3438
	cashu_mint_url: string
	site_port: 8180
	network_root: '/var/lib/plebeian-auctions-friday/network'
	dkg_root: '/var/lib/plebeian-auctions-friday/frost/keyset-v1'
	coordinator_root: '/var/lib/plebeian-auctions-friday/coordinator'
	coordinator_rpc_identity_path: '/var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.key'
}

export interface DemoFridayLiveApplicationV3 {
	schema: 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3'
	deployment_id: 'friday-demo-20261023-r20'
	run_id: 'friday-demo-20261023-r20-run1'
	application_host_slot: 1 | 2 | 3 | 4
	fips_ulas: FourStrings
	comet_p2p_port: 27656
	comet_rpc_port: 27657
	signer_rpc_port: 39101
	mint_port: 3438
	cashu_mint_url: string
	site_port: 8180
	network_root: '/var/lib/plebeian-auctions-friday/network-r20'
	dkg_root: '/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2'
	coordinator_root: '/var/lib/plebeian-auctions-friday/coordinator-v2'
	coordinator_rpc_identity_path: '/var/lib/plebeian-auctions-friday/coordinator-v2/coordinator-rpc-identity.key'
}

export interface DemoFridaySeparatedApplication {
 schema: 'PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1'
 role: 'APPLICATION' | 'VALIDATOR_SIGNER'
 participant_id: 0 | 1 | 2 | 3 | 4
 deployment_id: typeof SEPARATED_DEPLOYMENT_ID
 run_id: typeof SEPARATED_APPLICATION_RUN_ID
 application_host_id: 'linode-109290386'
 application_ipv4: '139.162.161.233'
 application_fips_ula: string
 fips_ulas: FourStrings
 comet_p2p_port: 27656
 comet_rpc_port: 27657
 signer_rpc_port: 39101
 mint_port: 3438
 cashu_mint_url: typeof SEPARATED_PUBLIC_ORIGIN
 site_port: 8180
 network_root: '/var/lib/plebeian-auctions-friday/network-separated'
 dkg_root: '/var/lib/plebeian-auctions-friday/frost-v3/keyset-v3'
 coordinator_root: '/var/lib/plebeian-auctions-friday/coordinator-v3/runtime'
 coordinator_rpc_identity_path: '/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/coordinator-rpc-identity.key'
}
export type DemoFridayLiveApplication = DemoFridayLiveApplicationV2 | DemoFridayLiveApplicationV3 | DemoFridaySeparatedApplication
export type DemoFridayApplication = DemoFridayLabApplicationV2 | DemoFridayLiveApplication
export function isSeparatedApplication(value: DemoFridayApplication): value is DemoFridaySeparatedApplication { return value.schema === 'PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1' }

function exactKeys(value: object, expected: string[], label: string): void {
	const actual = Object.keys(value).sort()
	const wanted = [...expected].sort()
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`DEMO_FRIDAY_CONFIG: ${label} has missing or unexpected fields`)
}

function exactText(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 160 || value.trim() !== value
		|| /[\u0000-\u001f\u007f/\\]/.test(value)) throw new Error(`DEMO_FRIDAY_CONFIG: ${label} is invalid`)
	return value
}

function exactUlas(value: unknown): FourStrings {
	if (!Array.isArray(value) || value.length !== 4) throw new Error('DEMO_FRIDAY_CONFIG: exactly four FIPS ULAs are required')
	const ulas = value.map((entry) => {
		if (typeof entry !== 'string') throw new Error('DEMO_FRIDAY_CONFIG: FIPS ULA is not text')
		const normalized = entry.replaceAll('[', '').replaceAll(']', '').toLowerCase()
		if (isIP(normalized) !== 6 || !/^(?:fc|fd)/.test(normalized) || normalized.includes('%')) {
			throw new Error('DEMO_FRIDAY_CONFIG: FIPS address must be an unscoped IPv6 ULA')
		}
		return normalized
	}) as FourStrings
	if (new Set(ulas).size !== 4) throw new Error('DEMO_FRIDAY_CONFIG: FIPS ULAs must be unique')
	return ulas
}

function canonicalAbsolute(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.startsWith('/') || resolve(value) !== value || value === '/'
		|| value.endsWith('/') || value.includes('//')) throw new Error(`DEMO_FRIDAY_CONFIG: ${label} is not a canonical absolute path`)
	return value
}

function exactPublicMint(value: unknown): string {
	if (typeof value !== 'string') throw new Error('DEMO_FRIDAY_CONFIG: public Cashu mint is not text')
	let url: URL
	try { url = new URL(value) }
	catch { throw new Error('DEMO_FRIDAY_CONFIG: public Cashu mint is not a URL') }
	if (value !== url.origin || url.protocol !== 'https:' || url.port !== '' || url.username !== ''
		|| url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
		throw new Error('DEMO_FRIDAY_CONFIG: public Cashu mint must be one exact HTTPS origin')
	}
	return url.origin
}

function within(root: string, value: string): boolean { return value.startsWith(`${root}/`) }

export function exactDemoFridayApplication(value: unknown): DemoFridayApplication {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('DEMO_FRIDAY_CONFIG: application must be an object')
	const raw = value as Record<string, unknown>
	if (raw.schema === 'PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1') {
		exactKeys(raw, ['schema','role','participant_id','deployment_id','run_id','application_host_id','application_ipv4',
		 'application_fips_ula','fips_ulas','comet_p2p_port','comet_rpc_port','signer_rpc_port','mint_port','cashu_mint_url',
		 'site_port','network_root','dkg_root','coordinator_root','coordinator_rpc_identity_path'], 'separated application')
		if ((raw.role !== 'APPLICATION' && raw.role !== 'VALIDATOR_SIGNER')
		 || (raw.role === 'APPLICATION' ? raw.participant_id !== 0 : ![1,2,3,4].includes(raw.participant_id as number))) {
			throw new Error('DEMO_FRIDAY_CONFIG: separated app must be nonparticipant; signer requires exactly slot1..4')
		}
		const ulas = exactUlas(raw.fips_ulas)
		const appUla = typeof raw.application_fips_ula === 'string' ? raw.application_fips_ula : ''
		if (isIP(appUla) !== 6 || !/^(?:fc|fd)/.test(appUla) || appUla.includes('%')
		 || new URL(`http://[${appUla}]/`).hostname !== `[${appUla}]` || ulas.includes(appUla)) throw new Error('DEMO_FRIDAY_CONFIG: app FIPS identity must be separate')
		const result: DemoFridaySeparatedApplication = { schema: raw.schema, role: raw.role,
		 participant_id: raw.participant_id as 0|1|2|3|4, deployment_id: SEPARATED_DEPLOYMENT_ID,
		 run_id: SEPARATED_APPLICATION_RUN_ID, application_host_id: 'linode-109290386', application_ipv4: '139.162.161.233',
		 application_fips_ula: appUla, fips_ulas: ulas, comet_p2p_port:27656, comet_rpc_port:27657, signer_rpc_port:39101,
		 mint_port:3438, cashu_mint_url:SEPARATED_PUBLIC_ORIGIN, site_port:8180,
		 network_root:'/var/lib/plebeian-auctions-friday/network-separated',dkg_root:'/var/lib/plebeian-auctions-friday/frost-v3/keyset-v3',
		 coordinator_root:'/var/lib/plebeian-auctions-friday/coordinator-v3/runtime',
		 coordinator_rpc_identity_path:'/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/coordinator-rpc-identity.key' }
		for (const [key, expected] of Object.entries(result)) {
		 if (key === 'fips_ulas') continue
		 if (raw[key] !== expected) throw new Error('DEMO_FRIDAY_CONFIG: separated fixed role/identity/roots/ports differ')
		}
		return result
	}
	if (raw.schema === 'PLEBEIAN_FRIDAY_FIPS_LAB_APPLICATION_V2') {
		exactKeys(raw, ['schema', 'run_id', 'fips_ulas', 'comet_p2p_port', 'comet_rpc_port', 'signer_rpc_port', 'mint_port', 'network_root', 'dkg_root', 'driver_result'], 'lab application')
		const runId = exactText(raw.run_id, 'run_id')
		const networkRoot = canonicalAbsolute(raw.network_root, 'network_root')
		const dkgRoot = canonicalAbsolute(raw.dkg_root, 'dkg_root')
		const driverResult = canonicalAbsolute(raw.driver_result, 'driver_result')
		if (![networkRoot, dkgRoot, driverResult].every((path) => path.startsWith(LAB_PREFIX))
			|| raw.comet_p2p_port !== 26656 || raw.comet_rpc_port !== 26657
			|| raw.signer_rpc_port !== 39101 || raw.mint_port !== 3338) {
			throw new Error('DEMO_FRIDAY_CONFIG: lab roots or ports differ from the reviewed topology')
		}
		return { schema: raw.schema, run_id: runId, fips_ulas: exactUlas(raw.fips_ulas), comet_p2p_port: 26656,
			comet_rpc_port: 26657, signer_rpc_port: 39101, mint_port: 3338, network_root: networkRoot,
			dkg_root: dkgRoot, driver_result: driverResult }
	}
	if (raw.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2') {
		exactKeys(raw, ['schema', 'deployment_id', 'run_id', 'application_host_slot', 'fips_ulas', 'comet_p2p_port', 'comet_rpc_port', 'signer_rpc_port', 'mint_port', 'cashu_mint_url', 'site_port', 'network_root', 'dkg_root', 'coordinator_root', 'coordinator_rpc_identity_path'], 'live application')
		if (![1, 2, 3, 4].includes(raw.application_host_slot as number)) {
			throw new Error('DEMO_FRIDAY_CONFIG: application host slot must name one validator host')
		}
		const application: DemoFridayLiveApplicationV2 = {
			schema: raw.schema, deployment_id: exactText(raw.deployment_id, 'deployment_id'),
			run_id: exactText(raw.run_id, 'run_id'), application_host_slot: raw.application_host_slot as 1 | 2 | 3 | 4,
			fips_ulas: exactUlas(raw.fips_ulas),
			comet_p2p_port: 27656, comet_rpc_port: 27657, signer_rpc_port: 39101,
			mint_port: 3438, cashu_mint_url: exactPublicMint(raw.cashu_mint_url), site_port: 8180,
			network_root: '/var/lib/plebeian-auctions-friday/network',
			dkg_root: '/var/lib/plebeian-auctions-friday/frost/keyset-v1',
			coordinator_root: '/var/lib/plebeian-auctions-friday/coordinator',
			coordinator_rpc_identity_path: '/var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.key',
		}
		if (raw.comet_p2p_port !== application.comet_p2p_port || raw.comet_rpc_port !== application.comet_rpc_port
			|| raw.signer_rpc_port !== application.signer_rpc_port || raw.mint_port !== application.mint_port
			|| raw.site_port !== application.site_port || raw.network_root !== application.network_root
			|| raw.dkg_root !== application.dkg_root || raw.coordinator_root !== application.coordinator_root
			|| raw.coordinator_rpc_identity_path !== application.coordinator_rpc_identity_path) {
			throw new Error('DEMO_FRIDAY_CONFIG: live roots or ports differ from the blue/green topology')
		}
		return application
	}
	if (raw.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3') {
		exactKeys(raw, ['schema', 'deployment_id', 'run_id', 'application_host_slot', 'fips_ulas', 'comet_p2p_port', 'comet_rpc_port', 'signer_rpc_port', 'mint_port', 'cashu_mint_url', 'site_port', 'network_root', 'dkg_root', 'coordinator_root', 'coordinator_rpc_identity_path'], 'R20 live application')
		if (![1, 2, 3, 4].includes(raw.application_host_slot as number)) {
			throw new Error('DEMO_FRIDAY_CONFIG: application host slot must name one validator host')
		}
		const application: DemoFridayLiveApplicationV3 = {
			schema: raw.schema, deployment_id: 'friday-demo-20261023-r20',
			run_id: 'friday-demo-20261023-r20-run1',
			application_host_slot: raw.application_host_slot as 1 | 2 | 3 | 4,
			fips_ulas: exactUlas(raw.fips_ulas),
			comet_p2p_port: 27656, comet_rpc_port: 27657, signer_rpc_port: 39101,
			mint_port: 3438, cashu_mint_url: exactPublicMint(raw.cashu_mint_url), site_port: 8180,
			network_root: '/var/lib/plebeian-auctions-friday/network-r20',
			dkg_root: '/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2',
			coordinator_root: '/var/lib/plebeian-auctions-friday/coordinator-v2',
			coordinator_rpc_identity_path: '/var/lib/plebeian-auctions-friday/coordinator-v2/coordinator-rpc-identity.key',
		}
		if (raw.deployment_id !== application.deployment_id || raw.run_id !== application.run_id
			|| raw.comet_p2p_port !== application.comet_p2p_port || raw.comet_rpc_port !== application.comet_rpc_port
			|| raw.signer_rpc_port !== application.signer_rpc_port || raw.mint_port !== application.mint_port
			|| raw.site_port !== application.site_port || raw.network_root !== application.network_root
			|| raw.dkg_root !== application.dkg_root || raw.coordinator_root !== application.coordinator_root
			|| raw.coordinator_rpc_identity_path !== application.coordinator_rpc_identity_path) {
			throw new Error('DEMO_FRIDAY_CONFIG: R20 roots, identifiers, or ports differ from the fixed topology')
		}
		return application
	}
	throw new Error('DEMO_FRIDAY_CONFIG: unsupported application schema')
}

export function exactDemoFridayApplicationInputPath(value: string): string {
	const path = canonicalAbsolute(value, 'application path')
	if (path === `${FRIDAY_LIVE_CONFIG_ROOT}/application.json` || path.startsWith(LAB_PREFIX)) return path
	throw new Error('DEMO_FRIDAY_CONFIG: application path is outside the lab or Friday config root')
}

export function exactDemoFridayPublicInputPath(value: string, label: string): string {
	const path = canonicalAbsolute(value, label)
	if (within(FRIDAY_LIVE_STATE_ROOT, path) || path.startsWith(LAB_PREFIX)) return path
	throw new Error(`DEMO_FRIDAY_CONFIG: ${label} is outside the lab or Friday state root`)
}

export function exactDemoFridayStatePath(application: DemoFridayApplication, value: string, label: string): string {
	const path = canonicalAbsolute(value, label)
	const allowed = application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
		|| application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3'
		|| isSeparatedApplication(application)
		? within(FRIDAY_LIVE_STATE_ROOT, path)
		: path.startsWith(LAB_PREFIX)
	if (!allowed) throw new Error(`DEMO_FRIDAY_CONFIG: ${label} is outside this application's state root`)
	return path
}

export function exactDemoFridayCoordinatorAnchorPath(application: DemoFridayApplication, value: string): string {
	const path = canonicalAbsolute(value, 'coordinator anchor database')
	if (application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
		|| application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3' || isSeparatedApplication(application)) {
		if (isSeparatedApplication(application)) {
		 if (application.role !== 'APPLICATION' || path !== '/var/lib/plebeian-auctions-friday-anchor-separated/coordinator.sqlite3') throw new Error('DEMO_FRIDAY_CONFIG: separated coordinator anchor/role differs')
		 return path
		}
		const expected = application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3'
			? FRIDAY_R20_COORDINATOR_ANCHOR : FRIDAY_LIVE_COORDINATOR_ANCHOR
		if (path !== expected) throw new Error('DEMO_FRIDAY_CONFIG: live coordinator anchor path differs')
		return path
	}
	if (!path.startsWith(LAB_PREFIX)) throw new Error('DEMO_FRIDAY_CONFIG: lab coordinator anchor is outside the run root')
	return path
}

export function demoFridayNodeRoot(application: DemoFridayApplication, slot: 1 | 2 | 3 | 4): string {
	if (isSeparatedApplication(application)) {
	 if (application.role !== 'VALIDATOR_SIGNER' || application.participant_id !== slot) throw new Error('DEMO_FRIDAY_CONFIG: app cannot acquire signer state')
	 return `${FRIDAY_LIVE_STATE_ROOT}/separated/node-${slot}`
	}
	if (application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3') {
		return `${FRIDAY_LIVE_STATE_ROOT}/r20/node-${slot}`
	}
	return application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
		? `${FRIDAY_LIVE_STATE_ROOT}/frost/node-${slot}` : resolve(application.dkg_root, '..', `node-${slot}`)
}

export function demoFridayLoopbackRpc(application: DemoFridayApplication): string {
	return `http://127.0.0.1:${application.comet_rpc_port}`
}

export function demoFridayMintUrl(application: DemoFridayApplication): string {
	if (isSeparatedApplication(application)) return `http://[${application.application_fips_ula}]:${application.mint_port}`
	const slot = application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
		|| application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3' ? application.application_host_slot : 1
	return `http://[${application.fips_ulas[slot - 1]}]:${application.mint_port}`
}

/** Canonical token/receipt identity.  Lab V2 has no browser and stays ULA-only. */
export function demoFridayMintIdentityUrl(application: DemoFridayApplication): string {
	if (isSeparatedApplication(application)) return application.cashu_mint_url
	return application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
		|| application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3'
		? application.cashu_mint_url
		: demoFridayMintUrl(application)
}
