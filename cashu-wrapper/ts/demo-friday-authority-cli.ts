#!/usr/bin/env bun
import { isSeparatedApplication } from './demo-friday-runtime-config'
import { SEPARATED_AUTHORITY_PARTICIPANT_BINARY } from './demo-friday-separated-constants'
import { loadSeparatedServiceBinding } from './demo-friday-separated-service'
import { SEPARATED_INPUT_ROOT } from './demo-friday-separated-profile'
import { supportedNutNumbers } from './demo-sigall-live-mint'
import { loadFridayHealthConfig, matchingFridayMint, matchingFridayConsensusPins } from './demo-friday-health-config'
import { createFridayReadinessProbe, type FridayHealthPins } from './demo-friday-readiness'
import { probeFridaySignerHealth, collectFridayReadySigners } from './demo-friday-signer-health'
/** Fixed-path, loopback-only Friday authority process. Public exposure is separately gated. */
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { hasValidDleq } from '@cashu/cashu-ts'

import { authenticatedDemoCometState, createLoopbackCometReader, createPinnedObserverCometReader } from './demo-comet-displacement-verifier'
import { createLoopbackCometBidBroadcaster, createLoopbackCometTxRecovery } from './demo-comet-bid-consensus'
import { runDemoFridayAuthorityProcess } from './demo-friday-authority-process'
import {
	DemoFridayTrustedTerminalSqlite,
	createDemoFridayAuthorityHealth,
} from './demo-friday-authority-runtime'
import {
	DemoFridayAuthenticatedTerminalDiscovery,
	DemoFridayDiscoveringTerminalSource,
} from './demo-friday-terminal-discovery'
import { createDemoFridayTerminalAuthorityRuntime } from './demo-friday-terminal-authority-runtime'
import { DemoFridayCoordinatorSqlite } from './demo-friday-coordinator-runtime'
import { DemoFridayCoordinatorRollbackAnchorSqlite } from './demo-friday-coordinator-rollback-anchor'
import {
	DemoFridayFundingReplayRollbackAnchorSqlite,
	DemoFridayFundingReplaySqlite,
	DemoFridayPreparedFundingAdmission,
} from './demo-friday-prepared-funding'
import {
	DemoFridayV4BroadcastJournalSqlite,
	DemoFridayV4BroadcastRollbackAnchorSqlite,
	createDemoFridayV4FundingAdmission,
} from './demo-friday-v4-funding-service'
import {
	createDemoFridayPinnedGenesisFilePort,
	createDemoFridayV4CometAdmission,
} from './demo-friday-v4-comet-admission'
import { createDemoFipsAdmissionParticipantPort, createDemoFipsAdmissionThreshold3Port } from './demo-fips-admission-coordinator'
import { createDemoFipsAdmissionRpcClient } from './demo-fips-admission-rpc'
import { DemoAdmissionSqliteSessionStore } from './demo-frost-threshold3-admission'
import {
	createDemoFipsFundingAbortCommittee,
	DemoFundingAbortSessionRollbackAnchorSqlite,
	DemoFundingAbortSqliteSessionStore,
} from './demo-fips-funding-abort-coordinator'
import { createDemoFipsFundingAbortRpcClient } from './demo-fips-funding-abort-rpc'
import { createDemoFridayFundingAbortComet } from './demo-friday-funding-abort-comet'
import { createDemoFridayFundingAbortService } from './demo-friday-funding-abort-service'
import {
	DemoFridayFundingAbortJournalSqlite,
	DemoFridayFundingAbortRollbackAnchorSqlite,
} from './demo-friday-funding-abort-sqlite'
import { createDemoFridayFundingAbortTerminalBridge } from './demo-friday-funding-abort-terminal-bridge'
import { DemoFridayCocoTerminalExchangeSqlite } from './demo-friday-coco-terminal-exchange'
import {
	createDemoFridayBrowserTrustService,
} from './demo-friday-browser-trust-service'
import {
	DemoFridaySellerPlanRollbackAnchorSqlite,
	DemoFridaySellerPlanSqlite,
} from './demo-friday-browser-trust-sqlite'
import {
	createDemoFridayFixedTerminalResolver,
	DemoFridayTerminalDescriptorSqlite,
	type DemoFridayTerminalNetworkPinsV1,
} from './demo-friday-fixed-terminal-resolver'
import {
	createDemoFridayLiveRecoveryPorts,
	createDemoFridayTerminalParticipants,
} from './demo-fips-r4-terminal-cli'
import { offlineStoreKey, xonly, type Facts } from './demo-fips-integrated-driver'
import {
	assertDemoFridayPublicPackageBytes,
	verifyDemoFridayPublicDkgV2,
} from './demo-friday-signer-dkg-v2'
import type { DemoFridayAuthenticatedDkgResultV2 } from './demo-friday-per-validator-dkg-bootstrap-v2'
import { DemoIntegratedAuthoritySqliteStore } from './demo-integrated-authority-sqlite'
import {
	DemoFundingAbortCapsuleEncryptedSqliteStore,
	DemoMaintainerEncryptedSqliteStore,
	DemoSigAllRecoverySqliteStore,
} from './demo-integrated-private-sqlite'
import {
	createDemoMaintainerOfflineExecutor,
	type DemoMaintainerExactBranchTemplate,
} from './demo-maintainer-offline'
import type { DemoMaintainerFederationPort } from './demo-maintainer-federation'
import {
	demoFridayMintIdentityUrl,
	demoFridayMintUrl,
	exactDemoFridayApplication,
	exactDemoFridayApplicationInputPath,
	FRIDAY_LIVE_CONFIG_ROOT,
	FRIDAY_LIVE_COORDINATOR_ANCHOR,
	FRIDAY_LIVE_FUNDING_ABORT_ANCHOR,
	FRIDAY_LIVE_FUNDING_BROADCAST_ANCHOR,
	FRIDAY_LIVE_FUNDING_REPLAY_ANCHOR,
	FRIDAY_LIVE_SELLER_PLAN_ANCHOR,
	FRIDAY_R20_COORDINATOR_ANCHOR,
	FRIDAY_R20_FUNDING_ABORT_ANCHOR,
	FRIDAY_R20_FUNDING_BROADCAST_ANCHOR,
	FRIDAY_R20_FUNDING_REPLAY_ANCHOR,
	FRIDAY_R20_SELLER_PLAN_ANCHOR,
} from './demo-friday-runtime-config'
import { createPinnedMintTransportFetch } from './coco-rail'
import { DemoSignerCoordinatorAnchorSqlite } from './demo-signer-coordinator-anchor-sqlite'
import { createCashuMintSigAllBranchAwarePort } from './demo-sigall-live-mint'
import type { DemoIntegratedRecoveryAuditPort } from './demo-integrated-outbid-return'
import { CashuMintClient, proofPoint } from './nut-client'
import { demoDenominationKeyDigest } from './demo-sigall-settlement'
import { exactDemoNut07Result } from './demo-nut07-exact'
import { demoFridayBrowserAbortPoolDigest } from './demo-friday-browser-funding-abort'
import { createDemoFridayRecoveryOnlyGuard } from './demo-friday-recovery-only'
import { demoFridayR20ServicePins, loadDemoFridayR20ServiceBinding } from './demo-friday-r20-service-binding'
import { DEMO_FRIDAY_R20_PARTICIPANT_BINARY } from './demo-friday-r20-path-contract'

const HEX_32 = /^[0-9a-f]{64}$/
const AUTHORITY_CONFIG = `${FRIDAY_LIVE_CONFIG_ROOT}/authority.json`
const LEGACY_PARTICIPANT_BINARY = '/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant-3of4'
type ParticipantId = 1 | 2 | 3 | 4

export function demoFridayAuthorityParticipantBinary(
	schema: 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2' | 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3' | 'PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1',
): string {
	return schema === 'PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1' ? SEPARATED_AUTHORITY_PARTICIPANT_BINARY : schema !== 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
		? DEMO_FRIDAY_R20_PARTICIPANT_BINARY : LEGACY_PARTICIPANT_BINARY
}

/**
 * Create or revalidate the authority's private invocation-scratch parent.
 * The parent runtime directory is already service-private; refusing links,
 * shared modes, or another owner keeps aggregate inputs out of shared paths.
 */
export async function ensureDemoFridayAuthorityScratch(path: string): Promise<string> {
	try { await mkdir(path, { mode: 0o700 }) }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
	}
	const metadata = await lstat(path)
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700
		|| metadata.uid !== process.getuid() || metadata.gid !== process.getgid()) {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: scratch parent must be a runtime-owned 0700 directory')
	}
	return path
}

function anchorPaths(schema: 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2' | 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3' | 'PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1') {
	if (schema === 'PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1') {
	 const root = '/var/lib/plebeian-auctions-friday-anchor-separated'
	 return { coordinator:`${root}/coordinator.sqlite3`,fundingReplay:`${root}/funding-replay.sqlite3`,fundingBroadcast:`${root}/funding-broadcast.sqlite3`,fundingAbort:`${root}/funding-abort.sqlite3`,sellerPlan:`${root}/seller-plan.sqlite3` }
	}
	if (schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2') return {
		coordinator: FRIDAY_LIVE_COORDINATOR_ANCHOR, fundingReplay: FRIDAY_LIVE_FUNDING_REPLAY_ANCHOR,
		fundingBroadcast: FRIDAY_LIVE_FUNDING_BROADCAST_ANCHOR, fundingAbort: FRIDAY_LIVE_FUNDING_ABORT_ANCHOR,
		sellerPlan: FRIDAY_LIVE_SELLER_PLAN_ANCHOR,
	}
	return {
		coordinator: FRIDAY_R20_COORDINATOR_ANCHOR, fundingReplay: FRIDAY_R20_FUNDING_REPLAY_ANCHOR,
		fundingBroadcast: FRIDAY_R20_FUNDING_BROADCAST_ANCHOR, fundingAbort: FRIDAY_R20_FUNDING_ABORT_ANCHOR,
		sellerPlan: FRIDAY_R20_SELLER_PLAN_ANCHOR,
	}
}

interface AuthorityConfigV1 {
	schema: 'PLEBEIAN_FRIDAY_AUTHORITY_CONFIG_V1'
	public_origin: string
	network_facts_sha256: string
	dkg_result_sha256: string
	participant_binary_sha256: string
}

function exactKeys(value: object, keys: string[]): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: config has unexpected fields')
	}
}

export interface DemoFridayAuthorityArgs {
	mode: 'serve' | 'init-state' | 'init-seller-plan'
	application: string
}

export function demoFridayAuthorityArgs(argv = process.argv.slice(2)): DemoFridayAuthorityArgs {
	if (argv.length !== 3 || !['serve', 'init-state', 'init-seller-plan'].includes(argv[0] ?? '') || argv[1] !== '--application') {
		throw new Error('usage: plebeian-friday-authority serve|init-state|init-seller-plan --application /etc/plebeian-auctions-friday/application.json')
	}
	const application = exactDemoFridayApplicationInputPath(argv[2]!)
	if (application !== `${FRIDAY_LIVE_CONFIG_ROOT}/application.json`) {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: only the fixed live application path is accepted')
	}
	return { mode: argv[0] as DemoFridayAuthorityArgs['mode'], application }
}

export interface DemoFridayAuthorityStorePaths {
	terminal: string
	coordinator: string
	authority: string
	private: string
	recovery: string
	signerAnchor: string
	coordinatorAnchor: string
	fundingReplay: string
	fundingReplayAnchor: string
	fundingBroadcast: string
	fundingBroadcastAnchor: string
	fundingAbort: string
	fundingAbortAnchor: string
	fundingAbortSessions: string
	admissionSessions: string
	terminalExchange: string
	sellerPlan: string
	sellerPlanAnchor: string
}

/**
 * Reserve and initialize the complete empty Friday authority state exactly
 * once.  All paths are O_EXCL-reserved before SQLite writes any schema.  A
 * partial reservation or constructor failure is intentionally retained for
 * operator inspection; this function never removes, truncates, resumes, or
 * silently enrolls a pre-existing file.
 *
 * The temporary zero key only permits the private-store constructor to create
 * its empty encrypted schema.  It is zeroized before return and is never
 * persisted; live records use the DKG/coordinator-derived key at serve time.
 */
export async function initializeDemoFridayAuthorityStores(options: {
	paths: DemoFridayAuthorityStorePaths
	deploymentId: string
}): Promise<void> {
	if (!/^[A-Za-z0-9_-]{1,160}$/.test(options.deploymentId)) {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: initialization deployment identity is invalid')
	}
	const entries = Object.entries(options.paths) as [keyof DemoFridayAuthorityStorePaths, string][]
	if (new Set(entries.map(([, path]) => path)).size !== entries.length
		|| entries.some(([, path]) => typeof path !== 'string' || !path.startsWith('/'))) {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: initialization paths are not distinct absolute paths')
	}
	const reservations: Awaited<ReturnType<typeof open>>[] = []
	try {
		for (const [, path] of entries) reservations.push(await open(path, 'wx', 0o600))
	} finally {
		for (const reservation of reservations.reverse()) await reservation.close()
	}
	const databases = Object.fromEntries(entries.map(([name, path]) =>
		[name, new Database(path, { create: false, strict: true })],
	)) as Record<keyof DemoFridayAuthorityStorePaths, Database>
	const emptyPrivateKey = new Uint8Array(32)
	try {
		const unavailableResolver = { async resolveExact(): Promise<never> {
			throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: initializer resolver is unavailable')
		} }
		new DemoFridayTerminalDescriptorSqlite(databases.terminal)
		new DemoFridayTrustedTerminalSqlite(databases.terminal, unavailableResolver)
		const coordinator = new DemoFridayCoordinatorSqlite(databases.coordinator, options.deploymentId)
		new DemoFridayCoordinatorRollbackAnchorSqlite(databases.coordinatorAnchor, true)
			.observeExact(coordinator.anchorSnapshot())
		new DemoIntegratedAuthoritySqliteStore(databases.authority)
		new DemoMaintainerEncryptedSqliteStore(databases.private, emptyPrivateKey)
		new DemoSigAllRecoverySqliteStore(databases.recovery)
		new DemoSignerCoordinatorAnchorSqlite(databases.signerAnchor)
		const replay = new DemoFridayFundingReplaySqlite(databases.fundingReplay, options.deploymentId)
		new DemoFridayFundingReplayRollbackAnchorSqlite(databases.fundingReplayAnchor, true)
			.observeExact(replay.anchorSnapshot())
		const broadcast = new DemoFridayV4BroadcastJournalSqlite(databases.fundingBroadcast, options.deploymentId)
		new DemoFridayV4BroadcastRollbackAnchorSqlite(databases.fundingBroadcastAnchor, true)
			.observeExact(broadcast.anchorSnapshot())
		new DemoAdmissionSqliteSessionStore(databases.admissionSessions)
		const fundingAbort = new DemoFridayFundingAbortJournalSqlite(databases.fundingAbort, options.deploymentId)
		new DemoFridayFundingAbortRollbackAnchorSqlite(databases.fundingAbortAnchor, true)
			.observeExact(fundingAbort.anchorSnapshot())
		new DemoFundingAbortSqliteSessionStore(databases.fundingAbortSessions, {
			deploymentId: options.deploymentId,
			anchor: new DemoFundingAbortSessionRollbackAnchorSqlite(databases.fundingAbortAnchor, true),
			initialize: true,
		})
		new DemoFridayCocoTerminalExchangeSqlite(databases.terminalExchange, options.deploymentId)
		const sellerAnchor = new DemoFridaySellerPlanRollbackAnchorSqlite(databases.sellerPlanAnchor, true)
		const seller = new DemoFridaySellerPlanSqlite(databases.sellerPlan, options.deploymentId, sellerAnchor)
		if (coordinator.anchorSnapshot().globalRevision !== 0 || replay.anchorSnapshot().globalRevision !== 0
			|| broadcast.anchorSnapshot().globalRevision !== 0 || seller.anchorSnapshot().globalRevision !== 0) {
			throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: initialized authority state is not empty')
		}
	} finally {
		emptyPrivateKey.fill(0)
		for (const database of Object.values(databases).reverse()) database.close(false)
	}
}

/**
 * Create the empty seller-plan store and its independent rollback anchor once.
 *
 * Both paths are reserved with O_EXCL before SQLite is allowed to write. A
 * crash or partial failure intentionally leaves the reserved files for
 * operator inspection; this function never guesses that a pre-existing path
 * is safe to overwrite or resume.
 */
export async function initializeDemoFridaySellerPlanStores(options: {
	databasePath: string
	anchorPath: string
	deploymentId: string
}): Promise<void> {
	let databaseReservation: Awaited<ReturnType<typeof open>> | undefined
	let anchorReservation: Awaited<ReturnType<typeof open>> | undefined
	try {
		databaseReservation = await open(options.databasePath, 'wx', 0o600)
		anchorReservation = await open(options.anchorPath, 'wx', 0o600)
	} finally {
		await anchorReservation?.close()
		await databaseReservation?.close()
	}
	const database = new Database(options.databasePath, { create: false, strict: true })
	const anchorDatabase = new Database(options.anchorPath, { create: false, strict: true })
	try {
		const anchor = new DemoFridaySellerPlanRollbackAnchorSqlite(anchorDatabase, true)
		const store = new DemoFridaySellerPlanSqlite(database, options.deploymentId, anchor)
		const snapshot = store.anchorSnapshot()
		if (snapshot.globalRevision !== 0 || snapshot.deploymentId !== options.deploymentId) {
			throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: initialized seller-plan state is not empty and exact')
		}
	} finally {
		anchorDatabase.close(false)
		database.close(false)
	}
}

function exactAuthorityConfig(value: unknown): AuthorityConfigV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: authority config is not an object')
	exactKeys(value, ['schema', 'public_origin', 'network_facts_sha256', 'dkg_result_sha256', 'participant_binary_sha256'])
	const raw = value as Record<string, unknown>
	if (raw.schema !== 'PLEBEIAN_FRIDAY_AUTHORITY_CONFIG_V1' || typeof raw.public_origin !== 'string') {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: authority config schema differs')
	}
	const origin = new URL(raw.public_origin)
	if (origin.protocol !== 'https:' || origin.username !== '' || origin.password !== '' || origin.pathname !== '/'
		|| origin.search !== '' || origin.hash !== '') throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: public origin is not exact HTTPS')
	if (![raw.network_facts_sha256, raw.dkg_result_sha256, raw.participant_binary_sha256]
		.every((entry) => typeof entry === 'string' && HEX_32.test(entry))) {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: artifact pins are malformed')
	}
	return {
		schema: raw.schema, public_origin: origin.origin,
		network_facts_sha256: String(raw.network_facts_sha256), dkg_result_sha256: String(raw.dkg_result_sha256),
		participant_binary_sha256: String(raw.participant_binary_sha256),
	}
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }

async function exactSecret(path: string): Promise<Uint8Array> {
	const stat = await lstat(path); const uid = process.getuid?.()
	if (uid === undefined || !stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== uid) {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: coordinator identity owner or mode differs')
	}
	const value = (await readFile(path, 'utf8')).trim()
	if (!HEX_32.test(value)) throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: coordinator identity is malformed')
	return hexToBytes(value)
}

function audit(store: DemoSigAllRecoverySqliteStore): DemoIntegratedRecoveryAuditPort {
	return { async readExact(request) {
		const record = await store.read(request.scope)
		if (record === null) return { state: 'absent' as const }
		if (record.operationRoot !== request.operationRoot) throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: recovery operation root changed')
		return {
			state: record.state, requestDigest: record.requestDigest,
			...(record.terminal === undefined ? {} : { terminalResponseDigest: record.terminal.responseDigest }),
		}
	} }
}

function pins(facts: Facts, dkg: DemoFridayAuthenticatedDkgResultV2): DemoFridayTerminalNetworkPinsV1 {
	if (facts.committee_public_key !== dkg.committeePublicKey || dkg.participants.length !== 4
		|| !HEX_32.test(facts.genesis_sha256) || !HEX_32.test(facts.validators_hash)) {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: network and DKG identities disagree')
	}
	return {
		network: facts.chain_id, chainId: facts.chain_id, genesisHash: facts.genesis_sha256,
		validatorRosterVersion: facts.validator_roster_version, validatorsHash: facts.validators_hash,
		committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
		dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
		signerRosterDigest: dkg.signerRosterDigest, committeePublicKey: dkg.committeePublicKey,
		participants: dkg.participants.map((entry) => ({ identifier: entry.participantId, verifyingShare: entry.verifyingShare })),
	}
}

function admissionPorts(facts: Facts, dkg: DemoFridayAuthenticatedDkgResultV2, coordinatorSecret: Uint8Array) {
	const clients = dkg.participants.map((participant) => createDemoFipsAdmissionRpcClient({
		endpoint: participant.signerEndpoint.replace('/v1/frost', '/v1/admission'),
		binding: {
			participantId: participant.participantId, network: facts.chain_id, chainId: facts.chain_id,
			committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
			dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
			signerRosterDigest: dkg.signerRosterDigest, coordinatorIdentity: dkg.coordinatorIdentity,
			signerIdentity: participant.signerIdentity,
		},
		coordinatorIdentityPrivateKey: coordinatorSecret,
	})) as Parameters<typeof createDemoFipsAdmissionThreshold3Port>[0]['clients']
	const participants = clients.map((client, index) =>
		createDemoFipsAdmissionParticipantPort((index + 1) as ParticipantId, client),
	) as [
		ReturnType<typeof createDemoFipsAdmissionParticipantPort>, ReturnType<typeof createDemoFipsAdmissionParticipantPort>,
		ReturnType<typeof createDemoFipsAdmissionParticipantPort>, ReturnType<typeof createDemoFipsAdmissionParticipantPort>,
	]
	return { clients, participants }
}

export async function main(): Promise<void> {
	const cli = demoFridayAuthorityArgs()
	const application = exactDemoFridayApplication(JSON.parse(await readFile(cli.application, 'utf8')) as unknown)
	if (application.schema !== 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
		&& application.schema !== 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3' && !isSeparatedApplication(application)) {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: live application schema required')
	}
	if (isSeparatedApplication(application) && application.role !== 'APPLICATION') throw new Error('SEPARATED_AUTHORITY: app role required')
	const factsPath = join(application.network_root, 'network-facts.json')
	const r20Binding = isSeparatedApplication(application) ? await loadSeparatedServiceBinding({application}) : application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3'
		? await loadDemoFridayR20ServiceBinding({ application, pins: demoFridayR20ServicePins(), networkFactsPath: factsPath })
		: undefined
	const anchors = anchorPaths(application.schema)
	const participantBinary = demoFridayAuthorityParticipantBinary(application.schema)
	if (cli.mode === 'init-seller-plan') {
		await initializeDemoFridaySellerPlanStores({
			databasePath: join(application.coordinator_root, 'seller-plan.sqlite3'),
			anchorPath: anchors.sellerPlan,
			deploymentId: application.deployment_id,
		})
		return
	}
	if (cli.mode === 'init-state') {
		const root = application.coordinator_root
		await initializeDemoFridayAuthorityStores({
			deploymentId: application.deployment_id,
			paths: {
				terminal: join(root, 'terminal.sqlite3'), coordinator: join(root, 'operations.sqlite3'),
				authority: join(root, 'authority.sqlite3'), private: join(root, 'private.sqlite3'),
				recovery: join(root, 'recovery.sqlite3'), signerAnchor: join(root, 'signer-anchor.sqlite3'),
				coordinatorAnchor: anchors.coordinator,
				fundingReplay: join(root, 'funding-replay.sqlite3'), fundingReplayAnchor: anchors.fundingReplay,
				fundingBroadcast: join(root, 'funding-broadcast.sqlite3'), fundingBroadcastAnchor: anchors.fundingBroadcast,
				fundingAbort: join(root, 'funding-abort.sqlite3'), fundingAbortAnchor: anchors.fundingAbort,
				fundingAbortSessions: join(root, 'funding-abort-sessions.sqlite3'),
				admissionSessions: join(root, 'admission-sessions.sqlite3'),
				terminalExchange: join(root, 'terminal-exchange.sqlite3'), sellerPlan: join(root, 'seller-plan.sqlite3'),
				sellerPlanAnchor: anchors.sellerPlan,
			},
		})
		return
	}
	const authorityConfig = exactAuthorityConfig(JSON.parse(await readFile(AUTHORITY_CONFIG, 'utf8')) as unknown)
	if (application.cashu_mint_url !== authorityConfig.public_origin) {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: public site and canonical Cashu mint origin differ')
	}
	const dkgPath = isSeparatedApplication(application) ? `${SEPARATED_INPUT_ROOT}/runtime-binding.json` : application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3'
		? join(application.dkg_root, 'runtime-binding.json')
		: join(application.dkg_root, '..', 'public/dkg-result.json')
	const [factsBytes, dkgBytes, participantBytes] = await Promise.all([
		readFile(factsPath), readFile(dkgPath), readFile(participantBinary),
	])
	if (sha256(factsBytes) !== authorityConfig.network_facts_sha256
		|| sha256(dkgBytes) !== authorityConfig.dkg_result_sha256
		|| sha256(participantBytes) !== authorityConfig.participant_binary_sha256) {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: fixed artifact hash differs from reviewed config')
	}
	const publicDkg = (isSeparatedApplication(application) || application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3')
		? r20Binding!
		: verifyDemoFridayPublicDkgV2({
			application, expectedManifestDigest: process.env.FRIDAY_DKG_MANIFEST_DIGEST ?? '',
			dkgResult: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(dkgBytes)) as unknown,
			networkFacts: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(factsBytes)) as unknown,
		})
	if ('result' in publicDkg) assertDemoFridayPublicPackageBytes(publicDkg, await readFile(publicDkg.publicKeyPackagePath))
	const facts = publicDkg.facts as Facts
	const makeReader = (fetchImpl: typeof fetch) => isSeparatedApplication(application)
	 ? createPinnedObserverCometReader({chainId:facts.chain_id,nodeId:process.env.FRIDAY_OBSERVER_NODE_ID ?? '',fetchImpl})
	 : createLoopbackCometReader(`http://127.0.0.1:${application.comet_rpc_port}`,fetchImpl)
	const dkg = 'result' in publicDkg ? publicDkg.result : publicDkg.runtime.result
	const heldPins = pins(facts, dkg)
	const root = application.coordinator_root
	await ensureDemoFridayAuthorityScratch(join(root, 'scratch'))
	const coordinatorSecret = await exactSecret(application.coordinator_rpc_identity_path)
	if (xonly(coordinatorSecret) !== dkg.coordinatorIdentity) {
		coordinatorSecret.fill(0); throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: coordinator identity differs from DKG')
	}
	const key = offlineStoreKey(coordinatorSecret, facts, dkg)
	const recoveryOnlyValue = process.env.POC_FRIDAY_RECOVERY_ONLY ?? 'false'
	if (!['true', 'false'].includes(recoveryOnlyValue)) {
		key.fill(0); coordinatorSecret.fill(0)
		throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: POC_FRIDAY_RECOVERY_ONLY must be exactly true or false')
	}
	const terminalDb = new Database(join(root, 'terminal.sqlite3'), { create: false, strict: true })
	const coordinatorDb = new Database(join(root, 'operations.sqlite3'), { create: false, strict: true })
	const authorityDb = new Database(join(root, 'authority.sqlite3'), { create: false, strict: true })
	const privateDb = new Database(join(root, 'private.sqlite3'), { create: false, strict: true })
	const recoveryDb = new Database(join(root, 'recovery.sqlite3'), { create: false, strict: true })
	const signerAnchorDb = new Database(join(root, 'signer-anchor.sqlite3'), { create: false, strict: true })
	const coordinatorAnchorDb = new Database(anchors.coordinator, { create: false, strict: true })
	const fundingReplayDb = new Database(join(root, 'funding-replay.sqlite3'), { create: false, strict: true })
	const fundingReplayAnchorDb = new Database(anchors.fundingReplay, { create: false, strict: true })
	const fundingBroadcastDb = new Database(join(root, 'funding-broadcast.sqlite3'), { create: false, strict: true })
	const fundingBroadcastAnchorDb = new Database(anchors.fundingBroadcast, { create: false, strict: true })
	const fundingAbortDb = new Database(join(root, 'funding-abort.sqlite3'), { create: false, strict: true })
	const fundingAbortAnchorDb = new Database(anchors.fundingAbort, { create: false, strict: true })
	const fundingAbortSessionDb = new Database(join(root, 'funding-abort-sessions.sqlite3'), { create: false, strict: true })
	const admissionSessionDb = new Database(join(root, 'admission-sessions.sqlite3'), { create: false, strict: true })
	const terminalExchangeDb = new Database(join(root, 'terminal-exchange.sqlite3'), { create: false, strict: true })
	const sellerPlanDb = new Database(join(root, 'seller-plan.sqlite3'), { create: false, strict: true })
	const sellerPlanAnchorDb = new Database(anchors.sellerPlan, { create: false, strict: true })
	try {
		const reader = makeReader(
   ((input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5_000), redirect: 'error' })) as typeof fetch)
		const offlineStore = new DemoMaintainerEncryptedSqliteStore(privateDb, key)
		const abortCapsules = new DemoFundingAbortCapsuleEncryptedSqliteStore(privateDb, key)
		const authorityStore = new DemoIntegratedAuthoritySqliteStore(authorityDb)
		const recoveryStore = new DemoSigAllRecoverySqliteStore(recoveryDb)
		const signerAnchor = new DemoSignerCoordinatorAnchorSqlite(signerAnchorDb)
		const participants = await createDemoFridayTerminalParticipants({
			root: join(application.dkg_root, '..'), dkg, coordinatorSecret,
		}, signerAnchor)
		if (participants.length !== 4) throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: four signer transports are required')
		const mintUrl = demoFridayMintIdentityUrl(application)
		const healthPins: FridayHealthPins = { deploymentId: application.deployment_id, chainId: facts.chain_id,
   genesisSha256: facts.genesis_sha256, validatorsHash: facts.validators_hash,
   committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
   dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
   signerRosterDigest: dkg.signerRosterDigest, mintUrl }
  const healthConfig = await loadFridayHealthConfig(healthPins)
  const mintTransportUrl = demoFridayMintUrl(application)
		const mintFetch = createPinnedMintTransportFetch(mintUrl, mintTransportUrl, fetch)
		const sellerPlanRegistry = new DemoFridaySellerPlanSqlite(sellerPlanDb, application.deployment_id,
			new DemoFridaySellerPlanRollbackAnchorSqlite(sellerPlanAnchorDb))
  const readLiveDeployment = async (signal?: AbortSignal) => {
				const client = new CashuMintClient({ mintUrl, fetchImpl: ((input, init) => mintFetch(input, { ...init, signal: signal ?? AbortSignal.timeout(5_000) })) as typeof fetch })
				const info = await client.info(), advertised = await client.keysets()
				const active = advertised.keysets.filter((entry) => entry.active && entry.unit === 'sat')
				if (active.length !== 1 || (active[0]!.input_fee_ppk ?? 0) !== 0) {
					throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: browser mint requires one active zero-fee sat keyset')
				}
				const keysets = (await client.keys(active[0]!.id)).keysets.filter((entry) => entry.id === active[0]!.id && entry.unit === 'sat')
				if (keysets.length !== 1) throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: active mint keys are ambiguous')
				const keys = Object.fromEntries(Object.entries(keysets[0]!.keys).map(([amount, key]) => [amount, key.toLowerCase()]))
				const amounts = Object.keys(keys).map(Number).filter(Number.isSafeInteger).sort((left, right) => left - right)
				const nuts = supportedNutNumbers(info.nuts)
				if (typeof info.pubkey !== 'string' || !/^(?:02|03)[0-9a-f]{64}$/.test(info.pubkey)
					|| typeof info.version !== 'string' || info.version.length < 1 || amounts.length < 1) {
					throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: browser mint snapshot is malformed')
				}
				return {
					schema: 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_V1' as const,
					environmentId: application.deployment_id, authNetworkId: facts.chain_id, chainId: facts.chain_id,
					genesisSha256: facts.genesis_sha256,
					canonicalMintUrl: mintUrl,
					mintSnapshot: { mintUrl, mintPublicKey: info.pubkey, serverVersion: info.version,
						activeSatKeysetId: active[0]!.id, denominationKeyDigest: demoDenominationKeyDigest(keys),
						denominationAmounts: amounts, inputFeePpk: 0, nuts },
					keyset: { id: active[0]!.id, unit: 'sat' as const, keys }, committeePublicKey: dkg.committeePublicKey,
					committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
					dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
					signerRosterDigest: dkg.signerRosterDigest,
					participants: dkg.participants.map(({ participantId, verifyingShare }) => ({ identifier: participantId, verifyingShare })) as [
						{ identifier: 1; verifyingShare: string }, { identifier: 2; verifyingShare: string },
						{ identifier: 3; verifyingShare: string }, { identifier: 4; verifyingShare: string },
					],
				}
			  }
  const browserTrust = createDemoFridayBrowserTrustService({
   deployment: { readExact: () => readLiveDeployment() },
			auctions: { async readExact(auctionId) {
				const observed = await authenticatedDemoCometState(reader, facts.validators_hash, 1)
				const auction = observed.observation.state.auctions?.[auctionId]
				if (auction === undefined || auction.id !== auctionId || auction.status !== 'open'
					|| auction.funding_mode !== 'threshold_sigall_v1' || typeof auction.seller !== 'string'
					|| !/^[0-9a-f]{64}$/.test(auction.seller)
					|| !/^(?:02|03)[0-9a-f]{64}$/.test(auction.seller_coco_payment_public_key ?? '')) {
					throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: authenticated threshold auction is absent or malformed')
				}
				const leaderBidId = auction.leader_bid_id ?? ''
				const bid = leaderBidId === '' ? undefined : observed.observation.state.bids?.[leaderBidId]
				if (leaderBidId !== '' && (bid === undefined || bid.id !== leaderBidId || bid.auction_id !== auctionId
					|| !/^[0-9a-f]{64}$/.test(bid.bidder) || !Number.isSafeInteger(bid.amount) || bid.amount < 1)) {
					throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: authenticated auction leader is malformed')
				}
				return {
					schema: 'PLEBEIAN_FRIDAY_AUTHENTICATED_AUCTION_V1' as const,
					authNetworkId: facts.chain_id, chainId: facts.chain_id, auctionId, status: 'open' as const,
					fundingMode: 'threshold_sigall_v1' as const, sellerActor: auction.seller,
					sellerPaymentPublicKey: auction.seller_coco_payment_public_key!, leaderBidId,
					leaderActor: bid?.bidder ?? '', leaderBidAmount: bid?.amount ?? 0,
					stateHeight: observed.observation.queryHeight, appHash: observed.observation.appHash,
					evidenceDigest: sha256(new TextEncoder().encode(JSON.stringify([
						'PLEBEIAN_FRIDAY_AUTHENTICATED_AUCTION_V1', facts.chain_id, observed.observation.queryHeight,
						observed.observation.appHash, auctionId, auction.seller, auction.seller_coco_payment_public_key,
						leaderBidId, bid?.bidder ?? '', bid?.amount ?? 0,
					]))),
				}
			} },
			registry: sellerPlanRegistry,
			nowSeconds: () => Math.floor(Date.now() / 1_000),
		})
		const recovery = createDemoFridayLiveRecoveryPorts(mintUrl, mintFetch)
		const terminalExchange = new DemoFridayCocoTerminalExchangeSqlite(terminalExchangeDb, application.deployment_id)
		const executorFor = (template: DemoMaintainerExactBranchTemplate, recipientActorId: string) => ({
			store: offlineStore, recoveryStore,
			mint: createCashuMintSigAllBranchAwarePort({ mintUrl, transportMintUrl: mintTransportUrl }), ...recovery,
			// The authenticated resolver derives this actor from committed state:
			// the displaced/no-sale bidder, or the seller for a winner payout.
			// Browser requests cannot select or redirect the recipient.
			recipient: terminalExchange.recipientFor(template, recipientActorId),
		})
		const descriptors = new DemoFridayTerminalDescriptorSqlite(terminalDb)
		const preparedFunding = new DemoFridayPreparedFundingAdmission({
			pins: { authNetworkId: facts.chain_id, chainId: facts.chain_id, mintUrl, nowSeconds: () => Math.floor(Date.now() / 1_000) },
			replay: new DemoFridayFundingReplaySqlite(fundingReplayDb, application.deployment_id),
			anchor: new DemoFridayFundingReplayRollbackAnchorSqlite(fundingReplayAnchorDb),
			privateStore: offlineStore,
			registeredWinner: browserTrust,
		})
		const fundingAbortEvidence = { async readExact(operationId: string) {
			const capsule = await abortCapsules.readByOperationExact(operationId)
			const template = capsule.refund
			const proofs = template.inputs
			const proofYs = proofs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
			const client = new CashuMintClient({ mintUrl, fetchImpl: mintFetch })
			const active = (await client.keysets()).keysets.filter((entry) => entry.active && entry.unit === 'sat')
			if (active.length !== 1 || active[0]!.id !== template.mintSeal.activeSatKeysetId
				|| (active[0]!.input_fee_ppk ?? 0) !== 0) {
				throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: abort evidence keyset is not active and zero-fee')
			}
			const keyset = (await client.keys(active[0]!.id)).keysets.find((entry) =>
				entry.id === active[0]!.id && entry.unit === 'sat')
			if (keyset === undefined || proofs.some((proof) => !hasValidDleq(proof as never, keyset as never, { require: true }))) {
				throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: abort evidence DLEQ verification failed')
			}
			const response = await mintFetch(`${mintUrl}/v1/checkstate`, { method: 'POST',
				headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Ys: proofYs }) })
			if (!response.ok) throw new Error(`DEMO_FRIDAY_AUTHORITY_CLI: abort NUT-07 HTTP ${response.status}`)
			const states = exactDemoNut07Result(proofYs, await response.json())
			if (states.states.some((state) => state !== 'UNSPENT')) {
				throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: abort pool is not entirely UNSPENT')
			}
			const preparedAt = capsule.createdAt
			const expiresAt = Math.min(template.locktime, preparedAt + 4_200)
			return {
				schema: 'PLEBEIAN_FRIDAY_LOCKED_ABORT_EVIDENCE_V1' as const,
				authNetworkId: facts.chain_id, chainId: facts.chain_id, genesisSha256: facts.genesis_sha256,
				auctionId: template.auctionId, operationId, actor: template.bidderActorId, mintUrl,
				activeKeysetId: template.mintSeal.activeSatKeysetId, amount: template.amount, proofYs,
				poolDigest: demoFridayBrowserAbortPoolDigest({ mintUrl, keysetId: template.mintSeal.activeSatKeysetId,
					amount: template.amount, proofYs }),
				nut11LockPublicKeys: [template.bidderPublicKey, template.committeePublicKey] as [string, string],
				locktime: template.locktime, paymentPublicKey: template.bidderPublicKey,
				refundPublicKey: template.refundPublicKey, committeePublicKey: template.committeePublicKey,
				returnPackageDigest: template.templateDigest, returnCashuSigAllDigest: template.cashuSigAllDigest,
				bidderReturnSignature: template.bidderMainSignature, fundingAuthorizationEventId: capsule.capsuleDigest,
				abortNotBefore: preparedAt, abortExpiresAt: expiresAt, committeeKeysetId: template.committeeKeysetId,
				committeeKeysetVersion: template.committeeKeysetVersion, dkgRunId: dkg.dkgRunId,
				publicKeyPackageSha256: dkg.publicKeyPackageSha256, signerRosterDigest: dkg.signerRosterDigest,
				dleqVerified: true as const, ownerVerified: true as const, returnPackageVerified: true as const,
				proofStates: proofYs.map((proofY) => ({ proofY, state: 'UNSPENT' as const })),
			}
		} }
		const resolver = createDemoFridayFixedTerminalResolver({
			descriptors, reader, pins: heldPins, offlineStore, authorityStore,
			fundingAbortEvidence, abortCapsules, abortCapsuleTerminalStore: abortCapsules,
			participants: participants as [typeof participants[0], typeof participants[0], typeof participants[0], typeof participants[0]],
			threshold: {
					binaryPath: participantBinary, publicKeyPackagePath: dkg.publicKeyPackagePath,
				scratchParent: join(root, 'scratch'), processTimeoutMs: 20_000, federationTimeoutMs: 25_000,
			}, executorFor, recoveryAudit: audit(recoveryStore), nowSeconds: () => Math.floor(Date.now() / 1_000),
		})
		const baseTerminalSource = new DemoFridayTrustedTerminalSqlite(terminalDb, resolver)
		// A reviewed health pin permits recovery startup while the mint is unavailable.
  // The old compatibility path still requires a live mint when pins are absent;
  // neither path enables admissions without composite readiness.
  const activeKeysetId = healthConfig?.mint.activeSatKeysetId ?? (await browserTrust.readDeploymentExact()).keyset.id
		const fundingAbortPins = {
			authNetworkId: facts.chain_id, chainId: facts.chain_id, genesisSha256: facts.genesis_sha256,
			mintUrl, activeKeysetId, committeePublicKey: dkg.committeePublicKey,
			committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
			dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
			signerRosterDigest: dkg.signerRosterDigest,
		}
		const fundingAbortClients = dkg.participants.map((participant) => createDemoFipsFundingAbortRpcClient({
			endpoint: participant.signerEndpoint.replace('/v1/frost', '/v1/funding-abort'),
			binding: {
				participantId: participant.participantId, network: facts.chain_id, chainId: facts.chain_id,
				committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
				dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
				signerRosterDigest: dkg.signerRosterDigest, coordinatorIdentity: dkg.coordinatorIdentity,
				signerIdentity: participant.signerIdentity,
			},
			coordinatorIdentityPrivateKey: coordinatorSecret,
		})) as Parameters<typeof createDemoFipsFundingAbortCommittee>[0]['clients']
		const fundingAbortJournal = new DemoFridayFundingAbortJournalSqlite(fundingAbortDb, application.deployment_id)
		const fundingAbortAnchor = new DemoFridayFundingAbortRollbackAnchorSqlite(fundingAbortAnchorDb)
		const fundingAbort = createDemoFridayFundingAbortService({
			pins: fundingAbortPins, evidence: fundingAbortEvidence,
			capsules: abortCapsules,
			proofState: { async readExact(proofYs) {
				const response = await mintFetch(`${mintUrl}/v1/checkstate`, { method: 'POST',
					headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Ys: proofYs }) })
				if (!response.ok) throw new Error(`DEMO_FRIDAY_AUTHORITY_CLI: abort state HTTP ${response.status}`)
				const exact = exactDemoNut07Result(proofYs, await response.json())
				return proofYs.map((proofY, index) => ({ proofY, state: exact.states[index]! }))
			} },
			committee: createDemoFipsFundingAbortCommittee({
				clients: fundingAbortClients, capsules: abortCapsules,
				sessions: new DemoFundingAbortSqliteSessionStore(fundingAbortSessionDb, {
					deploymentId: application.deployment_id,
					anchor: new DemoFundingAbortSessionRollbackAnchorSqlite(fundingAbortAnchorDb),
				}),
				binaryPath: participantBinary, publicKeyPackagePath: dkg.publicKeyPackagePath,
				scratchParent: join(root, 'scratch'), committeePublicKey: dkg.committeePublicKey,
			}),
			journal: fundingAbortJournal,
			journalAnchor: { observeExact() { fundingAbortAnchor.observeExact(fundingAbortJournal.anchorSnapshot()) } },
			consensus: createDemoFridayFundingAbortComet({
				pins: fundingAbortPins, validatorsHash: facts.validators_hash, reader,
				genesis: createDemoFridayPinnedGenesisFilePort({
					chainId: facts.chain_id, genesisSha256: facts.genesis_sha256,
					genesisPath: join(application.network_root, 'genesis.json'),
				}),
				broadcaster: createLoopbackCometBidBroadcaster(`http://127.0.0.1:${application.comet_rpc_port}`),
				recovery: createLoopbackCometTxRecovery(`http://127.0.0.1:${application.comet_rpc_port}`),
			}),
			terminal: createDemoFridayFundingAbortTerminalBridge({
				capsules: abortCapsules, descriptors, source: baseTerminalSource, exchange: terminalExchange,
			}),
			nowSeconds: () => Math.floor(Date.now() / 1_000),
		})
		const fundingPorts = admissionPorts(facts, dkg, coordinatorSecret)
		const fundingCommittee = createDemoFipsAdmissionThreshold3Port({
			clients: fundingPorts.clients, sessions: new DemoAdmissionSqliteSessionStore(admissionSessionDb),
				binaryPath: participantBinary, publicKeyPackagePath: dkg.publicKeyPackagePath,
			scratchParent: join(root, 'scratch'), committeePublicKey: dkg.committeePublicKey,
		})
		const fundingJournal = new DemoFridayV4BroadcastJournalSqlite(fundingBroadcastDb, application.deployment_id)
		const fundingAdmission = createDemoFridayV4FundingAdmission({
			prepared: preparedFunding, journal: fundingJournal,
			journalAnchor: new DemoFridayV4BroadcastRollbackAnchorSqlite(fundingBroadcastAnchorDb),
			leader: { async readExact(auctionId) {
				const observed = await authenticatedDemoCometState(reader, facts.validators_hash, 1)
				const auction = observed.observation.state.auctions?.[auctionId]
				if (auction === undefined || auction.status !== 'open') {
					throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: authenticated auction is absent or closed')
				}
				const bidId = auction.leader_bid_id ?? ''
				if (bidId === '') return { bidId: '', bidder: '', bidAmount: 0, height: observed.observation.queryHeight }
				const bid = observed.observation.state.bids?.[bidId]
				if (bid === undefined || bid.id !== bidId || bid.auction_id !== auctionId
					|| typeof bid.bidder !== 'string' || !/^[0-9a-f]{64}$/.test(bid.bidder)
					|| !Number.isSafeInteger(bid.amount) || bid.amount < 1) {
					throw new Error('DEMO_FRIDAY_AUTHORITY_CLI: authenticated leader bid is absent or malformed')
				}
				return { bidId, bidder: bid.bidder, bidAmount: bid.amount, height: observed.observation.queryHeight }
			} },
			dkgBinding: {
				dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
				signerRosterDigest: dkg.signerRosterDigest,
			},
			participants: fundingPorts.participants, committee: fundingCommittee,
			broadcaster: createLoopbackCometBidBroadcaster(`http://127.0.0.1:${application.comet_rpc_port}`),
			broadcastRecovery: createLoopbackCometTxRecovery(`http://127.0.0.1:${application.comet_rpc_port}`),
			cometAdmission: createDemoFridayV4CometAdmission({
				chainId: facts.chain_id, genesisSha256: facts.genesis_sha256, validatorsHash: facts.validators_hash,
				reader, genesis: createDemoFridayPinnedGenesisFilePort({
					chainId: facts.chain_id, genesisSha256: facts.genesis_sha256,
					genesisPath: join(application.network_root, 'genesis.json'),
				}), prepared: preparedFunding,
				onFailure(diagnostic) { console.error(JSON.stringify(diagnostic)) },
			}),
			nowSeconds: () => Math.floor(Date.now() / 1_000), policyTimeoutMs: 15_000,
			onConfirmFailure(diagnostic) { console.error(JSON.stringify(diagnostic)) },
		})
		const degradedRecovery = createDemoFridayRecoveryOnlyGuard({
			readFundingRecoveryPhaseExact: (eventId) => fundingJournal.readExact(eventId)?.phase ?? null,
			hasTerminalNoticeExact: (actor, operationId) => terminalExchange.readExact({
				actor, fundingOperationId: operationId,
			}) !== null,
			hasSellerPlanExact: (operationId) => sellerPlanRegistry.readExact(operationId) !== null,
			readAbortCapsuleExact: (operationId) => abortCapsules.readByOperationExact(operationId),
		})
  const recoveryOnly = recoveryOnlyValue === 'true' ? degradedRecovery : undefined
		const discovery = new DemoFridayAuthenticatedTerminalDiscovery({
			reader, pins: heldPins, prepared: preparedFunding, descriptors, source: baseTerminalSource,
		})
		const terminalSource = new DemoFridayDiscoveringTerminalSource(baseTerminalSource, discovery)
		const coordinatorStore = new DemoFridayCoordinatorSqlite(coordinatorDb, application.deployment_id)
		const rollbackAnchor = new DemoFridayCoordinatorRollbackAnchorSqlite(coordinatorAnchorDb)
		const noFederation: DemoMaintainerFederationPort = { async authorize() { throw new Error('threshold authorization must already be durable') } }
		const readOnlyExecutor = createDemoMaintainerOfflineExecutor({
			...executorFor({} as never, '0'.repeat(64)), federation: noFederation,
			outcomes: { async readExact() { throw new Error('outcome selection must already be durable') } },
		})
		const terminalRuntime = createDemoFridayTerminalAuthorityRuntime({
			authorityStore, coordinatorStore, rollbackAnchor, preparedReader: {
				async readPreparedExact(identity) {
					const abort = await abortCapsules.readTerminalExact(identity)
					return abort === null ? readOnlyExecutor.readPreparedExact(identity) : abort.prepared
				},
			},
		})
		const health = createDemoFridayAuthorityHealth({
			deploymentId: application.deployment_id, chainId: facts.chain_id,
			coordinatorStore, rollbackAnchor, terminalSource,
			commitReader: { async readExact(signal) {
    const healthReader = makeReader(
     ((input, init) => fetch(input, { ...init, signal, redirect: 'error' })) as typeof fetch)
    const state = await authenticatedDemoCometState(healthReader, facts.validators_hash, 1, signal)
				return { chainId: state.observation.state.chain_id, height: state.observation.queryHeight }
			} },
		})
  const readiness = createFridayReadinessProbe({ pins: healthPins, async collect(signal) {
   if (healthConfig === undefined || recoveryOnly !== undefined || process.env.POC_FRIDAY_BROWSER_READY !== 'true') throw new Error('HEALTH_NOT_CONFIGURED_OR_RECOVERY_ONLY')
   // All required observations are collected within the one outer deadline.
   const boundedReader = makeReader(
    ((input, init) => fetch(input, { ...init, signal, redirect: 'error' })) as typeof fetch)
   const [authority, committed, liveMint, signers] = await Promise.all([
    health.readExact(), authenticatedDemoCometState(boundedReader, facts.validators_hash, 1, signal),
    // This reader uses the same pinned transport and validates mint capabilities.
    readLiveDeployment(signal),
    collectFridayReadySigners(dkg.participants.map((participant, index) => signerSignal =>
     probeFridaySignerHealth({ endpoint: participant.signerEndpoint,
      participantId: participant.participantId, signerIdentity: participant.signerIdentity,
      coordinatorSecret, pins: healthPins, enrollment: participants[index]!.signerBinding, anchor: signerAnchor, signal: signerSignal })), signal),
   ])
   if (!matchingFridayConsensusPins(committed.observation.state, fundingAbortPins)) throw new Error('HEALTH_CHAIN_BINDING')
   return { pins: healthPins, height: committed.observation.queryHeight,
    authorityReady: !authority.quarantined && authority.consensusAvailable !== false,
    mintReady: matchingFridayMint(liveMint.mintSnapshot, healthConfig),
    readySigners: signers }
  } })
		const stop = new AbortController()
		for (const name of ['SIGINT', 'SIGTERM'] as const) process.once(name, () => stop.abort())
		// This listener is loopback-only. Ordinary V4 funding, FundingAbortV1,
		// terminal 3-of-4 authorization, and browser Coco exchange are composed
		// here; public proxy activation remains a separate reviewed action.
		await runDemoFridayAuthorityProcess({
			publicOrigin: authorityConfig.public_origin, authNetworkId: facts.chain_id, chainId: facts.chain_id,
			mintUrl, nowSeconds: () => Math.floor(Date.now() / 1_000), terminalSource, terminalRuntime,
			health, readiness, readinessPins: healthPins, readinessConfigSha256: healthConfig === undefined ? undefined : process.env.POC_FRIDAY_HEALTH_PINS_SHA256, degradedRecovery, fundingAdmission, terminalExchange, browserTrust, fundingAbort, recoveryOnly, signal: stop.signal,
		})
	} finally {
		key.fill(0); coordinatorSecret.fill(0)
		sellerPlanAnchorDb.close(false); sellerPlanDb.close(false)
		terminalExchangeDb.close(false)
		fundingAbortSessionDb.close(false); fundingAbortAnchorDb.close(false); fundingAbortDb.close(false)
		admissionSessionDb.close(false); fundingBroadcastAnchorDb.close(false); fundingBroadcastDb.close(false)
		fundingReplayAnchorDb.close(false); fundingReplayDb.close(false)
		coordinatorAnchorDb.close(false); signerAnchorDb.close(false); recoveryDb.close(false)
		privateDb.close(false); authorityDb.close(false); coordinatorDb.close(false); terminalDb.close(false)
	}
}

if (import.meta.main) await main()
