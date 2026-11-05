/**
 * R4 normal-terminal CLI for the isolated fake-money FIPS lab.
 *
 * `prepare` creates two independently funded threshold auctions and persists
 * only the exact encrypted maintainer bundles plus a non-bearer public context.
 * `settle` waits for their committed closes and executes winner payout and
 * reserve-unmet return through the four authenticated signer RPC endpoints,
 * the real Rust 3-of-4 participant binary, Nutshell, NUT-07/NUT-09 recovery,
 * and recipient-private import. It opens no listener and has no emergency
 * refund mode; that authority is intentionally still absent.
 */
import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { HDKey } from '@scure/bip32'
import { getEncodedToken } from '@cashu/coco-core'
import { hasValidDleq } from '@cashu/cashu-ts'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import { createDemoCometBidConsensus, createLoopbackCometBidBroadcaster } from './demo-comet-bid-consensus'
import { createDemoCometCloseVerifier } from './demo-comet-close-verifier'
import { createLoopbackCometReader, type DemoParticipantConsensusReader } from './demo-comet-displacement-verifier'
import { deriveDemoCometSignedBidEvidence } from './demo-comet-signed-bid-verifier'
import { createDemoFipsAdmissionParticipantPort, createDemoFipsAdmissionThreshold3Port } from './demo-fips-admission-coordinator'
import { createDemoFipsAdmissionRpcClient } from './demo-fips-admission-rpc'
import {
	JsonRecipientJournal, compressed, digest, exactPath, json, mintFacts,
	mintPool, nostrSigner, offlineStoreKey, packageFor, post, replaceJson, signedEvent, xonly,
} from './demo-fips-integrated-driver'
import type { Application, Dkg, Facts } from './demo-fips-integrated-driver'
import { DemoAdmissionSqliteSessionStore } from './demo-frost-threshold3-admission'
import {
	demoFrostCommitteeLockedProofsDigest, demoFrostParticipantPolicyDigest,
	type DemoFrostParticipantPolicyPackage,
} from './demo-frost-participant-policy'
import type { DemoFrostProcessParticipant } from './demo-frost-process-boundary'
import { admitDemoIntegratedThreshold3Bid } from './demo-integrated-admission-service'
import { demoIntegratedTiming } from './demo-integrated-authority'
import { DemoIntegratedAuthoritySqliteStore } from './demo-integrated-authority-sqlite'
import { demoIntegratedCloseFinalityDigest } from './demo-integrated-close-authority'
import { DemoMaintainerEncryptedSqliteStore, DemoSigAllRecoverySqliteStore } from './demo-integrated-private-sqlite'
import { executeDemoIntegratedThreshold3Terminal } from './demo-integrated-threshold3-terminal-service'
import type { DemoIntegratedRecoveryAuditPort } from './demo-integrated-outbid-return'
import {
	demoMaintainerScopeFor, type DemoMaintainerExactBranchTemplate, type DemoMaintainerOfflineIdentity,
} from './demo-maintainer-offline'
import type { DemoMaintainerFederationRequest } from './demo-maintainer-federation'
import { DemoSignerCoordinatorAnchorSqlite } from './demo-signer-coordinator-anchor-sqlite'
import { createDemoSignerRpcTransport, type DemoSignerDurableBindingV1 } from './demo-signer-rpc'
import { createCashuMintSigAllBranchAwarePort } from './demo-sigall-live-mint'
import type { DemoSigAllReconciliationQuery } from './demo-sigall-recovery'
import { acceptDemoSigAllRecipientResponse, type DemoRecipientIntent } from './demo-sigall-recipient'
import { demoRecipientCapabilityDigest } from './demo-sigall-settlement'
import { exactDemoNut07Result } from './demo-nut07-exact'
import {
	CashuMintClient, keysetPublicKey, proofPoint, unblindBlindedSignature,
	generateSchnorrKeypair, type BlindedSignature, type BlindingData, type CashuKeyset, type CashuProof,
} from './nut-client'
import type { CocoRailPort } from './coco-rail'

const HEX_32 = /^[0-9a-f]{64}$/
const PARTICIPANTS = [1, 2, 3, 4] as const
type ParticipantId = typeof PARTICIPANTS[number]

type NormalBranch = 'winner_payout' | 'reserve_unmet_return'
interface PreparedCase {
	branch: NormalBranch
	auctionId: string
	operationId: string
	bidId: string
	admissionHeight: number
	bundleDigest: string
	scope: string
	amount: number
}
interface PreparedContext {
	schema: 'PLEBEIAN_FRIDAY_FIPS_R4_TERMINAL_PREPARED_V1'
	runId: string
	chainId: string
	mintUrl: string
	activeKeysetId: string
	cases: [PreparedCase, PreparedCase]
}

async function emitResult(path: string, value: unknown): Promise<void> {
	await replaceJson(path, value)
	// The privileged controller treats this inherited stdout pipe as the
	// authoritative result handoff.  The pathname copy is audit-only and must
	// match these exact bytes before it is admitted to sanitized evidence.
	process.stdout.write(`${JSON.stringify(value)}\n`)
}

function usage(): never {
	throw new Error('usage: plebeian-friday-integrated-driver-r4 prepare|settle --application PATH --dkg-result PATH --network-facts PATH --participant-binary PATH --context PATH --output PATH')
}

function args() {
	const argv = process.argv.slice(2)
	if (argv.length !== 13 || !['prepare', 'settle'].includes(argv[0]!)
		|| argv[1] !== '--application' || argv[3] !== '--dkg-result' || argv[5] !== '--network-facts'
		|| argv[7] !== '--participant-binary' || argv[9] !== '--context' || argv[11] !== '--output') usage()
	return {
		mode: argv[0] as 'prepare' | 'settle', application: exactPath(argv[2]!, 'application'),
		dkg: exactPath(argv[4]!, 'dkg'), facts: exactPath(argv[6]!, 'facts'), participantBinary: argv[8]!,
		context: exactPath(argv[10]!, 'context'), output: exactPath(argv[12]!, 'output'),
	}
}

async function common(cli: ReturnType<typeof args>) {
	const application = await json<Application>(cli.application)
	const dkg = await json<Dkg>(cli.dkg)
	const facts = await json<Facts>(cli.facts)
	if (application.schema !== 'PLEBEIAN_FRIDAY_FIPS_LAB_APPLICATION_V2' || dkg.runId !== application.run_id
		|| facts.committee_public_key !== dkg.committeePublicKey || !HEX_32.test(facts.validators_hash)
		|| dkg.participants.length !== 4) throw new Error('DEMO_FIPS_R4_CONFIG: public run identities disagree')
	const root = resolve(application.dkg_root, '..')
	const mintUrl = `http://[${application.fips_ulas[0]}]:3338`
	const site = 'http://127.0.0.1:8080'
	const rpc = 'http://127.0.0.1:26657'
	const coordinatorSecret = hexToBytes((await readFile(join(root, 'node-1/coordinator-rpc-identity.key'), 'utf8')).trim())
	if (xonly(coordinatorSecret) !== dkg.coordinatorIdentity) throw new Error('DEMO_FIPS_R4_COORDINATOR: identity mismatch')
	return { application, dkg, facts, root, mintUrl, site, rpc, coordinatorSecret }
}

function dkgBinding(dkg: Dkg) {
	return { dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256, signerRosterDigest: dkg.signerRosterDigest }
}

function admissionPorts(options: Awaited<ReturnType<typeof common>>) {
	const clients = options.dkg.participants.map((participant) => createDemoFipsAdmissionRpcClient({
		endpoint: participant.signerEndpoint.replace('/v1/frost', '/v1/admission'),
		binding: {
			participantId: participant.participantId, network: options.facts.chain_id, chainId: options.facts.chain_id,
			committeeKeysetId: options.dkg.committeeKeysetId, committeeKeysetVersion: options.dkg.committeeKeysetVersion,
			dkgRunId: options.dkg.dkgRunId, publicKeyPackageSha256: options.dkg.publicKeyPackageSha256,
			signerRosterDigest: options.dkg.signerRosterDigest, coordinatorIdentity: options.dkg.coordinatorIdentity,
			signerIdentity: participant.signerIdentity,
		},
		coordinatorIdentityPrivateKey: options.coordinatorSecret,
	})) as Parameters<typeof createDemoFipsAdmissionThreshold3Port>[0]['clients']
	const participants = clients.map((client, index) =>
		createDemoFipsAdmissionParticipantPort((index + 1) as ParticipantId, client),
	) as Parameters<typeof admitDemoIntegratedThreshold3Bid>[0]['participants']
	return { clients, participants }
}

async function prepareCase(options: {
	branch: NormalBranch
	reserve: number
	amount: number
	caseIndex: number
	common: Awaited<ReturnType<typeof common>>
	keyset: CashuKeyset
	seal: Awaited<ReturnType<typeof mintFacts>>['seal']
	sessions: DemoAdmissionSqliteSessionStore
	offlineStore: DemoMaintainerEncryptedSqliteStore
	ports: ReturnType<typeof admissionPorts>
	participantBinary: string
}): Promise<PreparedCase> {
	const { common: held } = options
	const sellerKey = hexToBytes(generateSchnorrKeypair().privateKeyHex)
	const actor = hexToBytes(generateSchnorrKeypair().privateKeyHex)
	const bidder = hexToBytes(generateSchnorrKeypair().privateKeyHex)
	const refund = hexToBytes(generateSchnorrKeypair().privateKeyHex)
	const seller = HDKey.fromMasterSeed(randomBytes(32))
	const auctionId = `fips-r4-${options.branch}-${Date.now()}-${options.caseIndex}`
	try {
		const created = await post(held.site, '/api/event', await signedEvent(sellerKey, 28640, {
			auction_id: auctionId, title: `R4 ${options.branch} fake-money lot`,
			description: 'isolated no-value FIPS threshold terminal acceptance', duration_seconds: 300,
			starting_bid: 100, min_increment: 100, reserve: options.reserve, funding_mode: 'threshold_sigall_v1',
		}))
		if (created.status !== 200) throw new Error(`DEMO_FIPS_R4_AUCTION: create HTTP ${created.status}`)
		const reader = createLoopbackCometReader(held.rpc)
		let state
		const deadline = Date.now() + 60_000
		do {
			state = await reader.readCurrentState()
			if (state.state.auctions?.[auctionId] !== undefined) break
			await Bun.sleep(200)
		} while (Date.now() < deadline)
		const auction = state?.state.auctions?.[auctionId]
		if (auction === undefined || !Number.isSafeInteger(auction.original_end_time) || !Number.isSafeInteger(auction.end_time)) {
			throw new Error('DEMO_FIPS_R4_AUCTION: committed timing absent')
		}
		const timing = demoIntegratedTiming(auction.original_end_time!, auction.end_time!)
		const mint = new CashuMintClient({ mintUrl: held.mintUrl })
		const inputs = await mintPool(mint, options.keyset, options.amount, timing.locktime,
			compressed(bidder), held.dkg.committeePublicKey, compressed(refund))
		const bundle = await packageFor({
			root: held.root, mintUrl: held.mintUrl, network: held.facts.chain_id, auctionId, amount: options.amount,
			replaces: '', now: Math.floor(Date.now() / 1000), originalEnd: auction.original_end_time!, end: auction.end_time!,
			actor, bidder, refund, seller, keyset: options.keyset, seal: options.seal, dkg: held.dkg, inputs,
		})
		const committee = createDemoFipsAdmissionThreshold3Port({
			clients: options.ports.clients, sessions: options.sessions, binaryPath: options.participantBinary,
			publicKeyPackagePath: held.dkg.publicKeyPackagePath, scratchParent: join(held.root, 'node-1/scratch'),
			committeePublicKey: held.dkg.committeePublicKey,
		})
		const admission = await admitDemoIntegratedThreshold3Bid({
			unsignedReceipt: bundle.unsignedReceipt, bundle: bundle.bundle, nowSeconds: Math.floor(Date.now() / 1000),
			dkgBinding: dkgBinding(held.dkg), participants: options.ports.participants, committee,
			offlineStore: options.offlineStore,
			consensus: createDemoCometBidConsensus({
				reader, broadcaster: createLoopbackCometBidBroadcaster(held.rpc), signer: nostrSigner(actor),
				chainId: held.facts.chain_id, validatorsHash: held.facts.validators_hash,
				nowSeconds: () => Math.floor(Date.now() / 1000),
			}), policyTimeoutMs: 15_000,
		})
		if (admission.commit.disposition.kind !== 'active' || admission.committeeAuthorization.participantIds.length !== 3) {
			throw new Error('DEMO_FIPS_R4_ADMISSION: bid is not active with threshold-three authorization')
		}
		return {
			branch: options.branch, auctionId, operationId: bundle.bundle.winner.operationId,
			bidId: admission.commit.bidId, admissionHeight: admission.commit.height,
				bundleDigest: bundle.bundle.bundleDigest, scope: demoMaintainerScopeFor(bundle.bundle.winner), amount: options.amount,
		}
	} finally {
		sellerKey.fill(0); actor.fill(0); bidder.fill(0); refund.fill(0)
	}
}

async function prepare(cli: ReturnType<typeof args>, held: Awaited<ReturnType<typeof common>>): Promise<void> {
	const mint = new CashuMintClient({ mintUrl: held.mintUrl })
	const { keyset, seal } = await mintFacts(mint, held.mintUrl)
	const ports = admissionPorts(held)
	const sessionDb = new Database(join(held.root, 'r4-terminal-admission.sqlite3'), { create: true, strict: true })
	const privateDb = new Database(join(held.root, 'r4-terminal-private.sqlite3'), { create: true, strict: true })
	const key = offlineStoreKey(held.coordinatorSecret, held.facts, held.dkg)
	const offlineStore = new DemoMaintainerEncryptedSqliteStore(privateDb, key)
	key.fill(0)
	try {
		const winner = await prepareCase({
			branch: 'winner_payout', reserve: 2_000, amount: 2_500, caseIndex: 1, common: held, keyset, seal,
			sessions: new DemoAdmissionSqliteSessionStore(sessionDb), offlineStore, ports, participantBinary: cli.participantBinary,
		})
		const reserveUnmet = await prepareCase({
			branch: 'reserve_unmet_return', reserve: 5_000, amount: 3_000, caseIndex: 2, common: held, keyset, seal,
			sessions: new DemoAdmissionSqliteSessionStore(sessionDb), offlineStore, ports, participantBinary: cli.participantBinary,
		})
		const context: PreparedContext = {
			schema: 'PLEBEIAN_FRIDAY_FIPS_R4_TERMINAL_PREPARED_V1', runId: held.application.run_id,
			chainId: held.facts.chain_id, mintUrl: held.mintUrl, activeKeysetId: keyset.id,
			cases: [winner, reserveUnmet],
		}
		await replaceJson(cli.context, context)
		await emitResult(cli.output, {
			schema: 'PLEBEIAN_FRIDAY_FIPS_R4_TERMINAL_PREPARE_RESULT_V1', prepared: true,
			branches: context.cases.map(({ branch, auctionId, operationId, amount }) => ({ branch, auctionId, operationId, amount })),
		})
	} finally {
		privateDb.close(false); sessionDb.close(false)
	}
}

function exactContext(value: PreparedContext, held: Awaited<ReturnType<typeof common>>): PreparedContext {
	if (value.schema !== 'PLEBEIAN_FRIDAY_FIPS_R4_TERMINAL_PREPARED_V1' || value.runId !== held.application.run_id
		|| value.chainId !== held.facts.chain_id || value.mintUrl !== held.mintUrl || value.cases.length !== 2
		|| value.cases[0]?.branch !== 'winner_payout' || value.cases[1]?.branch !== 'reserve_unmet_return'
		|| new Set(value.cases.flatMap((entry) => [entry.auctionId, entry.operationId, entry.bidId, entry.scope])).size !== 8
		|| value.cases.some((entry) => !Number.isSafeInteger(entry.amount) || entry.amount < 1
			|| !Number.isSafeInteger(entry.admissionHeight) || entry.admissionHeight < 1 || !HEX_32.test(entry.bidId)
				|| !HEX_32.test(entry.bundleDigest))) {
		throw new Error('DEMO_FIPS_R4_CONTEXT: prepared context is malformed or cross-run')
	}
	return structuredClone(value)
}

function hasClose(block: Awaited<ReturnType<DemoParticipantConsensusReader['readBlock']>>, auctionId: string): boolean {
	return block.transactions.some((raw) => {
		try {
			const value = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
			return value.version === 1 && value.type === 'close' && value.auction_id === auctionId
				&& JSON.stringify(Object.keys(value).sort()) === JSON.stringify(['auction_id', 'type', 'version'])
		} catch { return false }
	})
}

async function waitForCloseHeight(reader: DemoParticipantConsensusReader, prepared: PreparedCase): Promise<number> {
	const deadline = Date.now() + 2_700_000
	while (Date.now() < deadline) {
		const state = await reader.readCurrentState()
		if (state.state.auctions?.[prepared.auctionId]?.status === 'closed') {
			for (let height = prepared.admissionHeight; height <= state.queryHeight; height++) {
				const block = await reader.readBlock(height)
				if (hasClose(block, prepared.auctionId)) return height
			}
			throw new Error('DEMO_FIPS_R4_CLOSE: closed state has no exact close transaction')
		}
		await Bun.sleep(500)
	}
	throw new Error('DEMO_FIPS_R4_CLOSE: auction did not close inside the reviewed wait')
}

async function restoreExact(mintUrl: string, query: DemoSigAllReconciliationQuery,
	fetchImpl: typeof fetch): Promise<BlindedSignature[] | null> {
	const statesResponse = await fetchImpl(`${mintUrl}/v1/checkstate`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Ys: query.proofStateRefs }),
	})
	if (!statesResponse.ok) return null
	const states = exactDemoNut07Result(query.proofStateRefs, await statesResponse.json())
	if (!states.states.every((state) => state === 'SPENT')) return null
	const response = await fetchImpl(`${mintUrl}/v1/restore`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outputs: query.blindedOutputs }),
	})
	if (!response.ok) return null
	const value = await response.json() as { signatures?: BlindedSignature[] }
	if (!Array.isArray(value.signatures) || value.signatures.length !== query.blindedOutputs.length) return null
	return value.signatures.map((signature) => ({ ...signature, dleq: signature.dleq === undefined ? undefined : { ...signature.dleq } }))
}

export function createDemoFridayLiveRecoveryPorts(mintUrl: string, fetchImpl: typeof fetch = fetch) {
	return {
		recovery: {
			async reconcileExact(query: DemoSigAllReconciliationQuery) {
				const signatures = await restoreExact(mintUrl, query, fetchImpl)
				return signatures === null
					? { status: 'indeterminate' as const, reasonCode: 'NUT07_NUT09_NOT_TERMINAL' }
					: { status: 'completed' as const, signatures }
			},
		},
		terminalResponse: { async restoreCompleted(query: DemoSigAllReconciliationQuery) { const signatures = await restoreExact(mintUrl, query, fetchImpl); return signatures === null ? null : { signatures } } },
	}
}

function recoveryAudit(store: DemoSigAllRecoverySqliteStore): DemoIntegratedRecoveryAuditPort {
	return {
		async readExact(request) {
			const record = await store.read(request.scope)
			if (record === null) return { state: 'absent' as const }
			if (record.operationRoot !== request.operationRoot) throw new Error('DEMO_FIPS_R4_RECOVERY: operation root changed')
			return {
				state: record.state, requestDigest: record.requestDigest,
				...(record.terminal === undefined ? {} : { terminalResponseDigest: record.terminal.responseDigest }),
			}
		},
	}
}

export function createDemoFridayTerminalParticipants(
	held: { root: string; dkg: Pick<Dkg, 'participants'>; coordinatorSecret: Uint8Array; fetchImpl?: typeof fetch },
	anchor: DemoSignerCoordinatorAnchorSqlite,
): Promise<Array<DemoFrostProcessParticipant & { readonly signerBinding: Readonly<DemoSignerDurableBindingV1> }>> {
	return Promise.all(held.dkg.participants.map(async (participant) => {
		const enrollment = await json<{ schema: string; binding: DemoSignerDurableBindingV1; signerIdentity: string; digest: string; signature: string }>(
			join(held.root, `node-${participant.participantId}/signer-enrollment-public.json`),
		)
		const expected = digest(['COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1', enrollment.binding, participant.signerIdentity])
		if (enrollment.schema !== 'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1' || enrollment.digest !== expected
			|| enrollment.signerIdentity !== participant.signerIdentity
			|| !schnorr.verify(hexToBytes(enrollment.signature), hexToBytes(expected), hexToBytes(participant.signerIdentity))) {
			throw new Error('DEMO_FIPS_R4_ENROLLMENT: signer enrollment invalid')
		}
		const signerBinding = Object.freeze(structuredClone(enrollment.binding))
		const heldEnrollment = {
			participantId: participant.participantId, processIdentity: participant.signerIdentity,
			stateDirectory: participant.stateDirectory,
			stateDirectoryIdentity: signerBinding.stateDirectoryIdentity,
			verifyingShare: participant.verifyingShare,
		}
  // One public binding feeds both transport and health. A later file change
  // cannot silently refresh health while the active transport stays pinned.
		return {
   signerBinding,
			enrollment: heldEnrollment,
			transport: createDemoSignerRpcTransport({
				endpoint: participant.signerEndpoint, enrollment: heldEnrollment, signerBinding,
				anchor, coordinatorIdentityPrivateKey: held.coordinatorSecret, signerIdentity: participant.signerIdentity, fetchImpl: held.fetchImpl,
			}),
		}
	}))
}

export async function importDemoFridayRecipientWallet(options: {
	root: string
	template: DemoMaintainerExactBranchTemplate
	keyset: CashuKeyset
	cocoRail?: CocoRailPort
	request: { selectionRoot: string; templateDigest: string; role: 'winner_settlement' | 'refund'; operationId: string; recipientCapabilityDigest: string; signatures: BlindedSignature[] }
}) {
	const { template, request } = options
	if (request.templateDigest !== template.templateDigest || request.role !== template.role
		|| request.operationId !== template.operationId
		|| request.recipientCapabilityDigest !== demoRecipientCapabilityDigest(template.recipientCapability)) {
		throw new Error('DEMO_FIPS_R4_RECIPIENT: delivery identity differs from template')
	}
	const intent: DemoRecipientIntent = {
		schema: 'COCO_DEMO_RECIPIENT_INTENT_V1', network: template.network, chainId: template.chainId,
		auctionId: template.auctionId, operationId: template.operationId, role: template.role,
		mintUrl: template.mintUrl, unit: 'sat', recipientPublicKey: template.recipientPublicKey,
		amounts: template.outputs.map((output) => output.amount),
	}
	const journal = new JsonRecipientJournal(join(options.root, `${template.operationId}.${template.role}.json`))
	const walletPath = join(options.root, `${template.operationId}.${template.role}.wallet.json`)
	let prior: { operationId: string; proofs: CashuProof[] } | null = null
	if (options.cocoRail === undefined) {
		try { prior = await json(walletPath) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
	}
	let proofs: CashuProof[] = []
	const receipt = await acceptDemoSigAllRecipientResponse({
		intent, keyset: { id: options.keyset.id, unit: options.keyset.unit, keys: { ...options.keyset.keys } },
		response: {
			schema: 'COCO_DEMO_RECIPIENT_RESPONSE_V1', operationId: template.operationId,
			recipientCapabilityDigest: request.recipientCapabilityDigest, signatures: request.signatures,
		},
		roleBinding: {
			async assertWinnerRecipient(binding) { if (template.role !== 'winner_settlement' || binding.recipientPublicKey !== template.recipientPublicKey) throw new Error('winner recipient changed') },
			async assertRefundRecipient(binding) { if (template.role !== 'refund' || binding.recipientPublicKey !== template.recipientPublicKey) throw new Error('refund recipient changed') },
		},
		unblinder: {
			async unblindExact(value) {
				return value.signatures.map((signature, index) => {
					const opening = value.privateOpeningRefs[index]!
					return unblindBlindedSignature(signature, {
						secret: opening.secret, r: BigInt(`0x${opening.r}`), B_: opening.B_,
					} as BlindingData, keysetPublicKey(options.keyset, signature.amount))
				})
			},
		},
		verifier: {
			async verifyExact(value) {
				if (value.unblindedRef.reduce((sum, proof) => sum + proof.amount, 0) !== template.amount
					|| value.unblindedRef.some((proof) => !hasValidDleq(proof as never, options.keyset as never, { require: true }))) {
					throw new Error('DEMO_FIPS_R4_RECIPIENT: exact proof ownership verification failed')
				}
				return value.unblindedRef
			},
		},
		wallet: {
			async importVerified(value) {
				proofs = value.verifiedRef.map((proof) => structuredClone(proof))
				if (options.cocoRail !== undefined) {
					const token = getEncodedToken({ mint: template.mintUrl, proofs, unit: 'sat' } as never)
					const received = await options.cocoRail.receive({
						token, operationId: `friday-terminal-${template.operationId}-${template.role}`,
					})
					if (received.state !== 'finalized') throw new Error('DEMO_FIPS_R4_RECIPIENT: Coco receive is not finalized')
				} else {
					if (prior !== null && (prior.operationId !== template.operationId || JSON.stringify(prior.proofs) !== JSON.stringify(proofs))) {
						throw new Error('DEMO_FIPS_R4_RECIPIENT: wallet replay differs')
					}
					if (prior === null) await replaceJson(walletPath, { operationId: template.operationId, proofs })
				}
			},
		}, journal,
	})
	const refs = proofs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true)))
	const response = await fetch(`${template.mintUrl}/v1/checkstate`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Ys: refs }),
	})
	const states = exactDemoNut07Result(refs, await response.json())
	if (receipt.amount !== template.amount || states.states.some((state) => state !== 'UNSPENT')) {
		throw new Error('DEMO_FIPS_R4_RECIPIENT: imported proofs are not exact unspent value')
	}
	return { imported: true as const, alreadyImported: prior !== null, amount: receipt.amount, proofCount: proofs.length, states: states.states }
}

async function settleCase(options: {
	prepared: PreparedCase
	closeHeight: number
	held: Awaited<ReturnType<typeof common>>
	reader: DemoParticipantConsensusReader
	keyset: CashuKeyset
	offlineStore: DemoMaintainerEncryptedSqliteStore
	authorityStore: DemoIntegratedAuthoritySqliteStore
	recoveryStore: DemoSigAllRecoverySqliteStore
	participants: DemoFrostProcessParticipant[]
	anchor: DemoSignerCoordinatorAnchorSqlite
	participantBinary: string
}) {
	const { held, prepared } = options
	const closeVerifier = createDemoCometCloseVerifier({
		reader: options.reader, network: held.facts.chain_id, chainId: held.facts.chain_id,
		genesisHash: held.facts.genesis_sha256, validatorRosterVersion: held.facts.validator_roster_version,
		validatorsHash: held.facts.validators_hash, committeeKeysetId: held.dkg.committeeKeysetId,
		committeeKeysetVersion: held.dkg.committeeKeysetVersion, dkgRunId: held.dkg.dkgRunId,
		publicKeyPackageSha256: held.dkg.publicKeyPackageSha256, signerRosterDigest: held.dkg.signerRosterDigest,
	})
	const closeRequest = {
		network: held.facts.chain_id, chainId: held.facts.chain_id, genesisHash: held.facts.genesis_sha256,
		validatorRosterVersion: held.facts.validator_roster_version, auctionId: prepared.auctionId,
		closeHeight: options.closeHeight,
	}
	const certificate = await closeVerifier.verifyAndDerive(closeRequest)
	const expectedCause = prepared.branch === 'winner_payout' ? 'winner' : 'reserve_unmet'
	if (certificate.cause !== expectedCause || certificate.poolAmount !== prepared.amount) {
		throw new Error('DEMO_FIPS_R4_CLOSE: committed terminal branch or amount differs')
	}
	const record = await options.offlineStore.loadExact(prepared.scope, prepared.bundleDigest)
	if (record === null) throw new Error('DEMO_FIPS_R4_OFFLINE: admitted exact bundle is absent')
	const template = prepared.branch === 'winner_payout' ? record.bundle.winner : record.bundle.refund
	const signedBid = await deriveDemoCometSignedBidEvidence({
		reader: options.reader, validatorsHash: held.facts.validators_hash,
		minimumHeight: certificate.closeState.stateHeight, fundingOperationId: prepared.operationId,
		deposits: template.inputs.map((proof) => ({
			proofStateRef: bytesToHex(proofPoint(proof).toBytes(true)), amount: proof.amount, keysetId: proof.id,
		})), sellerRecipientPublicKey: record.bundle.winner.recipientPublicKey,
	})
	const policy: DemoFrostParticipantPolicyPackage = {
		schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_V1', network: certificate.network, chainId: certificate.chainId,
		auctionId: certificate.auctionId, operationId: certificate.fundingOperationId,
		bidId: certificate.fundingOperationId, bidEventId: certificate.fundingOperationId,
		bidderActorId: certificate.bidderActorId, role: template.role,
		outcomeHeight: certificate.commits[2].height, appStateHash: certificate.commits[2].appHash,
		amount: certificate.poolAmount, inputFee: 0, inputFeePpk: 0, mintUrl: template.mintUrl, unit: 'sat',
		activeKeysetId: template.mintSeal.activeSatKeysetId, locktime: template.locktime,
		bidderPublicKey: template.bidderPublicKey, committeePublicKey: template.committeePublicKey,
		sellerRecipientPublicKey: record.bundle.winner.recipientPublicKey, recipientPublicKey: template.recipientPublicKey,
		deposits: template.inputs.map((proof) => ({
			proofStateRef: bytesToHex(proofPoint(proof).toBytes(true)), amount: proof.amount, keysetId: proof.id,
		})), committeeLockedProofs: template.inputs.map((proof) => ({
			amount: proof.amount, id: proof.id, secret: proof.secret, C: proof.C,
			...(proof.dleq === undefined ? {} : { dleq: { ...proof.dleq } }),
		})), outputs: template.outputs.map((output) => ({ ...output })),
		recipientCapability: { ...template.recipientCapability }, packageDigest: template.templateDigest,
		cashuSigAllDigest: template.cashuSigAllDigest,
		actorPackageAuthorization: structuredClone(prepared.branch === 'winner_payout'
			? record.bundle.actorWinnerAuthorization : record.bundle.actorReturnAuthorization),
		certifiedClosure: {
			evidenceDigest: demoIntegratedCloseFinalityDigest(certificate),
			evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2', source: 'participant-local', kind: 'close', eventHeight: options.closeHeight },
		},
		signedBid: { evidenceDigest: signedBid.evidenceDigest, evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1', source: 'participant-local' } },
	}
	const policyDigest = demoFrostParticipantPolicyDigest(policy)
	const federationRequest: DemoMaintainerFederationRequest = {
		schema: 'COCO_DEMO_FROST_REQUEST_V1', threshold: 3, sessionId: randomBytes(32).toString('hex'),
		packageDigest: policy.packageDigest, cashuSigAllDigest: policy.cashuSigAllDigest,
		committeePublicKey: held.dkg.committeePublicKey, committeeKeysetId: held.dkg.committeeKeysetId,
		committeeKeysetVersion: held.dkg.committeeKeysetVersion,
		participants: held.dkg.participants.map((participant) => ({ identifier: participant.participantId, verifyingShare: participant.verifyingShare })),
		policyPackageDigest: policyDigest, closureEvidenceDigest: policy.certifiedClosure.evidenceDigest,
		signedBidEvidenceDigest: policy.signedBid.evidenceDigest,
		committeeLockedProofsDigest: demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs),
	}
	let imported: Awaited<ReturnType<typeof importDemoFridayRecipientWallet>> | undefined
	const ports = createDemoFridayLiveRecoveryPorts(held.mintUrl)
	const result = await executeDemoIntegratedThreshold3Terminal({
		branch: prepared.branch,
		options: {
			closeRequest, template, offlineIdentity: {
				scope: prepared.scope, bundleDigest: prepared.bundleDigest,
			} satisfies DemoMaintainerOfflineIdentity,
			closeVerifier, authorityStore: options.authorityStore, policy, federationRequest,
			threshold: {
				participants: options.participants as [DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant],
				dkgRunId: held.dkg.dkgRunId,
				publicKeyPackageSha256: held.dkg.publicKeyPackageSha256, signerRosterDigest: held.dkg.signerRosterDigest,
				binaryPath: options.participantBinary, publicKeyPackagePath: held.dkg.publicKeyPackagePath,
				scratchParent: join(held.root, 'node-1/scratch'), processTimeoutMs: 20_000, federationTimeoutMs: 25_000,
			},
			executor: {
				store: options.offlineStore, recoveryStore: options.recoveryStore,
				mint: createCashuMintSigAllBranchAwarePort({ mintUrl: held.mintUrl }), ...ports,
				recipient: { async deliverExact(request) { imported = await importDemoFridayRecipientWallet({ root: held.root, template, keyset: options.keyset, request }); return imported } },
			}, recoveryAudit: recoveryAudit(options.recoveryStore), nowSeconds: Math.floor(Date.now() / 1000),
		},
	})
	if (result.branch !== prepared.branch || result.result.payment.lifecycle.status !== 'recipient_imported' || imported === undefined) {
		throw new Error('DEMO_FIPS_R4_TERMINAL: branch did not reach recipient import')
	}
	const authorized = await options.offlineStore.loadExact(prepared.scope, prepared.bundleDigest)
	if (authorized?.authorization === undefined || authorized.authorization.threshold !== 3
		|| authorized.authorization.participantIds.length !== 3) {
		throw new Error('DEMO_FIPS_R4_TERMINAL: durable threshold-three authorization is absent')
	}
	const inputRefs = template.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true)))
	const response = await fetch(`${held.mintUrl}/v1/checkstate`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Ys: inputRefs }),
	})
	const inputs = exactDemoNut07Result(inputRefs, await response.json())
	if (inputs.states.some((state) => state !== 'SPENT')) throw new Error('DEMO_FIPS_R4_TERMINAL: settled inputs are not SPENT')
	return {
		branch: prepared.branch, auctionId: prepared.auctionId, operationId: prepared.operationId,
		amount: prepared.amount, closeHeight: options.closeHeight, lifecycle: result.result.payment.lifecycle.status,
		participantIds: [...authorized.authorization.participantIds], thresholdSignatureVerified: true,
		inputStates: inputs.states, recipientAmount: imported.amount, recipientProofCount: imported.proofCount,
		recipientStates: imported.states,
	}
}

async function settle(cli: ReturnType<typeof args>, held: Awaited<ReturnType<typeof common>>): Promise<void> {
	const context = exactContext(await json<PreparedContext>(cli.context), held)
	const reader = createLoopbackCometReader(held.rpc)
	const closeHeights: [number, number] = [
		await waitForCloseHeight(reader, context.cases[0]), await waitForCloseHeight(reader, context.cases[1]),
	]
	const mint = new CashuMintClient({ mintUrl: held.mintUrl })
	const { keyset } = await mintFacts(mint, held.mintUrl)
	if (keyset.id !== context.activeKeysetId) throw new Error('DEMO_FIPS_R4_MINT: active keyset changed after admission')
	const privateDb = new Database(join(held.root, 'r4-terminal-private.sqlite3'), { create: false, strict: true })
	const authorityDb = new Database(join(held.root, 'r4-terminal-authority.sqlite3'), { create: true, strict: true })
	const recoveryDb = new Database(join(held.root, 'r4-terminal-recovery.sqlite3'), { create: true, strict: true })
	const anchorDb = new Database(join(held.root, 'r4-terminal-coordinator-anchor.sqlite3'), { create: true, strict: true })
	const key = offlineStoreKey(held.coordinatorSecret, held.facts, held.dkg)
	const offlineStore = new DemoMaintainerEncryptedSqliteStore(privateDb, key)
	key.fill(0)
	const authorityStore = new DemoIntegratedAuthoritySqliteStore(authorityDb)
	const recoveryStore = new DemoSigAllRecoverySqliteStore(recoveryDb)
	const anchor = new DemoSignerCoordinatorAnchorSqlite(anchorDb)
	try {
		const participants = await createDemoFridayTerminalParticipants(held, anchor)
		const winner = await settleCase({
			prepared: context.cases[0], closeHeight: closeHeights[0], held, reader, keyset, offlineStore,
			authorityStore, recoveryStore, participants, anchor, participantBinary: cli.participantBinary,
		})
		const reserveUnmet = await settleCase({
			prepared: context.cases[1], closeHeight: closeHeights[1], held, reader, keyset, offlineStore,
			authorityStore, recoveryStore, participants, anchor, participantBinary: cli.participantBinary,
		})
		await emitResult(cli.output, {
			schema: 'PLEBEIAN_FRIDAY_FIPS_R4_TERMINAL_RESULT_V1', terminalBranches: [winner, reserveUnmet],
			emergencyRefund: { status: 'not_composed', reason: 'distinct admitted-pool unilateral authority is absent' },
			fakeMoneyOnly: true, fipsTransportRequired: true, oneSignerUnavailable: true,
		})
	} finally {
		anchorDb.close(false); recoveryDb.close(false); authorityDb.close(false); privateDb.close(false)
	}
}

export async function main(): Promise<void> {
	const cli = args()
	const held = await common(cli)
	try {
		if (cli.mode === 'prepare') await prepare(cli, held)
		else await settle(cli, held)
	} finally { held.coordinatorSecret.fill(0) }
}

if (import.meta.main) await main()
