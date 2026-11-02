#!/usr/bin/env bun
import { isSeparatedApplication } from './demo-friday-runtime-config'
import { loadSeparatedServiceBinding } from './demo-friday-separated-service'
/** One-shot, non-listening exact payment child for the persistent Friday coordinator. */
import { Database } from 'bun:sqlite'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hexToBytes } from '@noble/hashes/utils.js'

import { createDemoFridayLiveRecoveryPorts } from './demo-fips-r4-terminal-cli'
import {
	json, offlineStoreKey, xonly,
	type Facts,
} from './demo-fips-integrated-driver'
import {
	assertDemoFridayPublicPackageBytes,
	verifyDemoFridayPublicDkgV2,
} from './demo-friday-signer-dkg-v2'
import { DemoIntegratedAuthoritySqliteStore } from './demo-integrated-authority-sqlite'
import {
	DemoFundingAbortCapsuleEncryptedSqliteStore,
	DemoMaintainerEncryptedSqliteStore,
	DemoSigAllRecoverySqliteStore,
} from './demo-integrated-private-sqlite'
import {
	demoFridayExecutorIdentity,
	type DemoFridayExecutorIdentityV2,
} from './demo-friday-coordinator-cli'
import type { DemoFridayCoordinatorRecordV2, DemoFridayTerminalBranch } from './demo-friday-coordinator-runtime'
import {
	demoFridayMintIdentityUrl, demoFridayMintUrl,
	exactDemoFridayApplication, exactDemoFridayApplicationInputPath,
} from './demo-friday-runtime-config'
import { createDemoFridayTerminalExecutorPorts } from './demo-friday-terminal-executor-runtime'
import { createCashuMintSigAllBranchAwarePort } from './demo-sigall-live-mint'
import { createPinnedMintTransportFetch } from './coco-rail'
import { DemoFridayCocoTerminalExchangeSqlite } from './demo-friday-coco-terminal-exchange'
import { demoFridayR20ServicePins, loadDemoFridayR20ServiceBinding } from './demo-friday-r20-service-binding'

const HEX_32 = /^[0-9a-f]{64}$/
type Mode = 'execute' | 'recover' | 'import'

function exactText(value: string, label: string): string {
	if (value.length < 1 || value.length > 256 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
		throw new Error(`DEMO_FRIDAY_EXECUTOR_CLI: ${label} is invalid`)
	}
	return value
}

function exactDigest(value: string, label: string): string {
	if (!HEX_32.test(value)) throw new Error(`DEMO_FRIDAY_EXECUTOR_CLI: ${label} is not a digest`)
	return value
}

export function demoFridayTerminalExecutorArgs(argv = process.argv.slice(2)): { mode: Mode; application: string; identity: DemoFridayExecutorIdentityV2 } {
	const names = [
		'--application', '--deployment-id', '--scope', '--authority-operation-id', '--payment-operation-id',
		'--recipient-actor-id',
		'--operation-root', '--frost-operation-root', '--bundle-digest', '--branch', '--chain-id', '--execution-binding-digest',
		'--prepared-authorization-digest', '--selection-root', '--outcome-height',
	]
	if (!['execute', 'recover', 'import'].includes(argv[0] ?? '') || argv.length !== 1 + names.length * 2
		|| names.some((name, index) => argv[1 + index * 2] !== name)) {
		throw new Error('usage: plebeian-friday-terminal-executor execute|recover|import --application PATH --deployment-id ID --scope SCOPE --authority-operation-id ID --payment-operation-id ID --recipient-actor-id NPUB_HEX --operation-root SHA256 --frost-operation-root SHA256 --bundle-digest SHA256 --branch BRANCH --chain-id ID --execution-binding-digest SHA256 --prepared-authorization-digest SHA256 --selection-root SHA256 --outcome-height HEIGHT')
	}
	const value = (index: number): string => argv[2 + index * 2]!
	const branch = value(9) as DemoFridayTerminalBranch
	const outcomeHeight = Number(value(14))
	if (!['outbid_return', 'rejected_return', 'funding_abort_return', 'winner_payout', 'reserve_unmet_return'].includes(branch)
		|| !Number.isSafeInteger(outcomeHeight) || outcomeHeight < 1) {
		throw new Error('DEMO_FRIDAY_EXECUTOR_CLI: branch or outcome height is invalid')
	}
	return {
		mode: argv[0] as Mode,
		application: exactDemoFridayApplicationInputPath(value(0)),
		identity: {
			schema: 'PLEBEIAN_FRIDAY_EXECUTOR_IDENTITY_V2', deploymentId: exactText(value(1), 'deploymentId'),
			scope: exactText(value(2), 'scope'), authorityOperationId: exactText(value(3), 'authorityOperationId'),
				paymentOperationId: exactText(value(4), 'paymentOperationId'),
				recipientActorId: exactDigest(value(5), 'recipientActorId'),
				operationRoot: exactDigest(value(6), 'operationRoot'), frostOperationRoot: exactDigest(value(7), 'frostOperationRoot'),
				bundleDigest: exactDigest(value(8), 'bundleDigest'), branch, chainId: exactText(value(10), 'chainId'),
				executionBindingDigest: exactDigest(value(11), 'executionBindingDigest'),
				preparedAuthorizationDigest: exactDigest(value(12), 'preparedAuthorizationDigest'),
				selectionRoot: exactDigest(value(13), 'selectionRoot'), outcomeHeight,
		},
	}
}

async function exactSecret(path: string): Promise<Uint8Array> {
	const stat = await lstat(path)
	const uid = process.getuid?.()
	if (uid === undefined || !stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== uid) {
		throw new Error('DEMO_FRIDAY_EXECUTOR_SECRET: coordinator identity owner or mode differs')
	}
	const value = (await readFile(path, 'utf8')).trim()
	if (!HEX_32.test(value)) throw new Error('DEMO_FRIDAY_EXECUTOR_SECRET: coordinator identity is malformed')
	return hexToBytes(value)
}

function record(identity: DemoFridayExecutorIdentityV2): DemoFridayCoordinatorRecordV2 {
	return {
		schema: 'PLEBEIAN_FRIDAY_COORDINATOR_RECORD_V2', deploymentId: identity.deploymentId,
		scope: identity.scope, authorityOperationId: identity.authorityOperationId,
		paymentOperationId: identity.paymentOperationId, recipientActorId: identity.recipientActorId,
		operationRoot: identity.operationRoot,
		frostOperationRoot: identity.frostOperationRoot,
		bundleDigest: identity.bundleDigest, branch: identity.branch, chainId: identity.chainId,
		executionBindingDigest: identity.executionBindingDigest,
		preparedAuthorizationDigest: identity.preparedAuthorizationDigest,
		selectionRoot: identity.selectionRoot, outcomeHeight: identity.outcomeHeight,
		phase: 'executing', revision: 0, attempts: 1,
	}
}

export async function main(): Promise<void> {
	const cli = demoFridayTerminalExecutorArgs()
	const application = exactDemoFridayApplication(JSON.parse(await readFile(cli.application, 'utf8')) as unknown)
	if ((application.schema !== 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
		&& application.schema !== 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3' && !isSeparatedApplication(application))
		|| application.deployment_id !== cli.identity.deploymentId) {
		throw new Error('DEMO_FRIDAY_EXECUTOR_CONFIG: application differs from durable deployment')
	}
	if (isSeparatedApplication(application) && application.role !== 'APPLICATION') throw new Error('SEPARATED_EXECUTOR: app role required')
	const publicDkg = isSeparatedApplication(application) ? await loadSeparatedServiceBinding({application}) : application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3'
		? await loadDemoFridayR20ServiceBinding({ application, pins: demoFridayR20ServicePins() })
		: verifyDemoFridayPublicDkgV2({
			application, expectedManifestDigest: process.env.FRIDAY_DKG_MANIFEST_DIGEST ?? '',
			dkgResult: await json<unknown>('/var/lib/plebeian-auctions-friday/frost/public/dkg-result.json'),
			networkFacts: await json<unknown>(join(application.network_root, 'network-facts.json')),
		})
	if ('result' in publicDkg) assertDemoFridayPublicPackageBytes(publicDkg, await readFile(publicDkg.publicKeyPackagePath))
	const facts = publicDkg.facts as Facts
	const dkg = 'result' in publicDkg ? publicDkg.result : publicDkg.runtime.result
	if (facts.chain_id !== cli.identity.chainId) {
		throw new Error('DEMO_FRIDAY_EXECUTOR_CONFIG: public network and DKG identities disagree')
	}
	const secret = await exactSecret(application.coordinator_rpc_identity_path)
	if (xonly(secret) !== dkg.coordinatorIdentity) {
		secret.fill(0); throw new Error('DEMO_FRIDAY_EXECUTOR_SECRET: coordinator public identity differs from DKG')
	}
	const key = offlineStoreKey(secret, facts, dkg); secret.fill(0)
	const authorityDb = new Database(join(application.coordinator_root, 'authority.sqlite3'), { create: false, strict: true })
	const privateDb = new Database(join(application.coordinator_root, 'private.sqlite3'), { create: false, strict: true })
	const recoveryDb = new Database(join(application.coordinator_root, 'recovery.sqlite3'), { create: false, strict: true })
	const terminalExchangeDb = new Database(join(application.coordinator_root, 'terminal-exchange.sqlite3'), { create: false, strict: true })
	try {
		const mintUrl = demoFridayMintIdentityUrl(application)
		const mintTransportUrl = demoFridayMintUrl(application)
		const mintFetch = createPinnedMintTransportFetch(mintUrl, mintTransportUrl, fetch)
		const ports = createDemoFridayLiveRecoveryPorts(mintUrl, mintFetch)
		const terminalExchange = new DemoFridayCocoTerminalExchangeSqlite(terminalExchangeDb, application.deployment_id)
		const abortCapsules = new DemoFundingAbortCapsuleEncryptedSqliteStore(privateDb, key)
		const executor = createDemoFridayTerminalExecutorPorts({
			authorityStore: new DemoIntegratedAuthoritySqliteStore(authorityDb),
			offlineStore: new DemoMaintainerEncryptedSqliteStore(privateDb, key),
			abortCapsules, abortCapsuleTerminalStore: abortCapsules,
			recoveryStore: new DemoSigAllRecoverySqliteStore(recoveryDb),
			mint: createCashuMintSigAllBranchAwarePort({ mintUrl, transportMintUrl: mintTransportUrl }), ...ports,
			recipientFor(template, recipientActorId) { return terminalExchange.recipientFor(template, recipientActorId) },
		})
		const durable = record(cli.identity)
		const outcome = cli.mode === 'execute' ? await executor.executeExact(durable)
			: cli.mode === 'recover' ? await executor.recoverExact(durable)
				: await executor.importExact(durable)
		process.stdout.write(`${JSON.stringify({
			schema: 'PLEBEIAN_FRIDAY_EXECUTOR_RESULT_V1', identity: demoFridayExecutorIdentity(durable), outcome,
		})}\n`)
	} finally {
		key.fill(0); terminalExchangeDb.close(false); recoveryDb.close(false); privateDb.close(false); authorityDb.close(false)
	}
}

if (import.meta.main) await main()
