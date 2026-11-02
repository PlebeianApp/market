/**
 * One bounded, throwaway fake-money vertical slice:
 *
 * real Nutshell proofs -> four independent participant-policy processes (one
 * genuinely unavailable) -> real Rust 3-of-4 admission FROST -> real local
 * four-node Comet commit -> displacement with validator four unavailable ->
 * real Rust 3-of-4 SIG_ALL authorization -> one real mint spend whose response
 * is discarded -> NUT-09 recovery -> recipient-private unblind/import.
 *
 * The transport is loopback/stdio and explicitly is NOT FIPS evidence. The
 * enclosing shell owns the mint and deletes every throwaway private artifact.
 */
import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, open, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { hasValidDleq } from '@cashu/cashu-ts'
import { HDKey } from '@scure/bip32'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { createDemoAdmissionParticipantProcess, type DemoAdmissionParticipantProcess } from './demo-admission-participant-process'
import {
	createDemoCometBidConsensus,
	createLoopbackCometBidBroadcaster,
	type DemoNostrBidEvent,
	type DemoNostrBidSignerPort,
} from './demo-comet-bid-consensus'
import { createDemoCometDisplacementVerifier, createLoopbackCometReader } from './demo-comet-displacement-verifier'
import { deriveDemoCometSignedBidEvidence } from './demo-comet-signed-bid-verifier'
import { demoDispositionEnrollmentPermit } from './demo-disposition-signer-anchor'
import { DemoAdmissionSqliteSessionStore, createDemoFrostThreshold3AdmissionPort } from './demo-frost-threshold3-admission'
import { provisionEphemeralDemoThreshold3, type DemoThreshold3EphemeralKeyset } from './demo-frost-threshold3-dkg'
import { createDemoFrostStdioProcessTransport } from './demo-frost-stdio-transport'
import type { DemoFrostProcessParticipant } from './demo-frost-process-boundary'
import {
	demoFrostCommitteeLockedProofsDigest,
	demoFrostParticipantPolicyDigest,
	type DemoFrostParticipantPolicyPackage,
} from './demo-frost-participant-policy'
import { admitDemoIntegratedThreshold3Bid } from './demo-integrated-admission-service'
import {
	authorizeDemoCooperativeOutbidReturn,
	demoIntegratedDisplacementFinalityDigest,
	demoIntegratedTiming,
} from './demo-integrated-authority'
import { DemoIntegratedAuthoritySqliteStore } from './demo-integrated-authority-sqlite'
import {
	demoIntegratedFundingBundleDigest,
	prepareDemoIntegratedFundingReceipt,
	type DemoIntegratedFundingReceiptTerms,
} from './demo-integrated-funding-receipt'
import { DemoMaintainerEncryptedSqliteStore } from './demo-integrated-private-sqlite'
import {
	demoMaintainerExactTemplateDigest,
	demoMaintainerTemplateBundleDigest,
	type DemoMaintainerExactBranchTemplate,
	type DemoMaintainerExactTemplateBundle,
} from './demo-maintainer-offline'
import { createDemoMaintainerThreshold3ProcessComposition } from './demo-maintainer-threshold3-process'
import type { DemoMaintainerFederationRequest } from './demo-maintainer-federation'
import {
	acceptDemoSigAllRecipientResponse,
	prepareDemoSigAllRecipientOutputs,
	type DemoRecipientCoordinatorRequest,
	type DemoRecipientCoordinatorResponse,
	type DemoRecipientIntent,
	type DemoRecipientPrivateJournalPort,
	type DemoRecipientPrivateRecord,
} from './demo-sigall-recipient'
import {
	buildDemoSigAllSecret,
	demoCashuSigAllDigest,
	demoDenominationKeyDigest,
	demoRecipientCapabilityDigest,
	type DemoMintCapabilitySeal,
} from './demo-sigall-settlement'
import { exactDemoNut07Result } from './demo-nut07-exact'
import {
	blindMessage,
	CashuMintClient,
	generateSchnorrKeypair,
	keysetPublicKey,
	proofPoint,
	randomSecretHex,
	splitAmount,
	unblindBlindedSignature,
	type BlindedMessage,
	type BlindedSignature,
	type BlindingData,
	type CashuKeyset,
	type CashuProof,
} from './nut-client'

const ROOT = process.env.FRIDAY_INTEGRATED_ROOT ?? ''
const POC_BINARY = process.env.FRIDAY_POC_BINARY ?? ''
const EVIDENCE = process.env.FRIDAY_INTEGRATED_EVIDENCE ?? ''
const PARTICIPANT_BINARY = process.env.FRIDAY_FROST_PARTICIPANT_BINARY ?? resolve(import.meta.dir, '../frost-participant-3of4/target/debug/coco-demo-frost-participant-3of4-demo')
const INSPECTOR_BINARY = process.env.FRIDAY_FROST_INSPECTOR_BINARY ?? resolve(import.meta.dir, '../frost-public-inspect/target/debug/coco-demo-frost-public-inspect')
const MINT = 'http://127.0.0.1:3338'
const FAULT_MINT = process.env.FRIDAY_FAULT_MINT ?? ''
const SOURCE_COMMIT = process.env.FRIDAY_SOURCE_COMMIT ?? ''
const SITE = 'http://127.0.0.1:18080'
const RPC = 'http://127.0.0.1:28657'
const HEX_32 = /^[0-9a-f]{64}$/

type ManagedChild = ReturnType<typeof Bun.spawn>
type OpeningWire = { secret: string; r: string; B_: string }

function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value)))) }
async function fileSha256(path: string): Promise<string> { return new Bun.CryptoHasher('sha256').update(await readFile(path)).digest('hex') }
function compressed(privateKey: Uint8Array): string { return bytesToHex(secp256k1.getPublicKey(privateKey, true)) }
function xonly(privateKey: Uint8Array): string { return bytesToHex(schnorr.getPublicKey(privateKey)) }
function sign(value: string, privateKey: Uint8Array): string { return bytesToHex(schnorr.sign(hexToBytes(value), privateKey)) }

async function waitFor<T>(label: string, timeoutMs: number, read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
	const deadline = Date.now() + timeoutMs
	let last: unknown
	while (Date.now() < deadline) {
		try { const value = await read(); if (ready(value)) return value; last = value }
		catch (error) { last = error }
		await Bun.sleep(200)
	}
	throw new Error(`${label} timed out: ${last instanceof Error ? last.message : JSON.stringify(last)}`)
}

async function stopChild(child: ManagedChild | undefined): Promise<void> {
	if (child === undefined) return
	if (child.exitCode === null) child.kill('SIGTERM')
	const result = await Promise.race([child.exited, Bun.sleep(10_000).then(() => null)])
	if (result === null && child.exitCode === null) { child.kill('SIGKILL'); await child.exited }
}

async function replacePrivateJson(path: string, value: unknown): Promise<void> {
	const temporary = `${path}.${randomUUID()}.tmp`
	const handle = await open(temporary, 'wx', 0o600)
	try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync() } finally { await handle.close() }
	await rename(temporary, path); await chmod(path, 0o600)
}

function signer(privateKey: Uint8Array): DemoNostrBidSignerPort {
	const pubkey = xonly(privateKey)
	return Object.freeze({
		async getPublicKey() { return pubkey },
		async signEvent(unsigned: Omit<DemoNostrBidEvent, 'id' | 'sig'>) {
			const id = digest([0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content])
			return { ...structuredClone(unsigned), id, sig: sign(id, privateKey) }
		},
	})
}

async function post(path: string, value: unknown): Promise<{ status: number; body: any }> {
	const response = await fetch(`${SITE}${path}`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
	})
	return { status: response.status, body: await response.json() }
}

async function signedEvent(privateKey: Uint8Array, kind: number, content: unknown) {
	const base = { pubkey: xonly(privateKey), created_at: Math.floor(Date.now() / 1000), kind, tags: [], content: JSON.stringify(content) }
	const id = digest([0, base.pubkey, base.created_at, base.kind, base.tags, base.content])
	return { ...base, id, sig: sign(id, privateKey) }
}

function supportedNuts(value: unknown): number[] {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
	const found: number[] = []
	for (const [rawNut, rawSettings] of Object.entries(value as Record<string, unknown>)) {
		if (!/^(?:0|[1-9][0-9]*)$/.test(rawNut) || rawSettings === null || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) continue
		const nut = Number(rawNut); const settings = rawSettings as Record<string, unknown>
		if (nut === 4) {
			if (settings.disabled !== true && Array.isArray(settings.methods)
				&& settings.methods.some((method) => method !== null && typeof method === 'object'
					&& (method as Record<string, unknown>).method === 'bolt11' && (method as Record<string, unknown>).unit === 'sat')) found.push(nut)
		} else if (settings.supported === true) found.push(nut)
	}
	return found.sort((left, right) => left - right)
}

async function mintFacts(client: CashuMintClient): Promise<{ keyset: CashuKeyset; seal: DemoMintCapabilitySeal }> {
	const [info, advertised] = await Promise.all([client.info(), client.keysets()])
	const active = advertised.keysets.filter((entry) => entry.unit === 'sat' && entry.active)
	if (active.length !== 1 || (active[0]!.input_fee_ppk ?? 0) !== 0) throw new Error('throwaway mint must expose exactly one active zero-fee sat keyset')
	const keyset = (await client.keys(active[0]!.id)).keysets.find((entry) => entry.id === active[0]!.id && entry.unit === 'sat')
	if (keyset === undefined || typeof info.pubkey !== 'string' || !/^(?:02|03)[0-9a-f]{64}$/.test(info.pubkey)
		|| typeof info.version !== 'string') throw new Error('throwaway mint facts are malformed')
	const nuts = supportedNuts(info.nuts)
	if (![4, 7, 10, 11].every((nut) => nuts.includes(nut))) throw new Error('throwaway mint lacks required NUT support')
	const exactDenominations = Object.keys(keyset.keys)
	if (exactDenominations.length === 0 || exactDenominations.some((value) => !/^[1-9][0-9]*$/.test(value))) {
		throw new Error('throwaway mint exposes a malformed denomination key')
	}
	// The digest binds every exact uint64 denomination. The number[] projection
	// intentionally exposes only denominations this application can represent.
	const denominationAmounts = exactDenominations.map(BigInt)
		.filter((value) => value <= BigInt(Number.MAX_SAFE_INTEGER))
		.map(Number).sort((left, right) => left - right)
	if (denominationAmounts.length === 0) throw new Error('throwaway mint exposes no safe application denomination')
	return { keyset, seal: {
		mintUrl: MINT, mintPublicKey: info.pubkey, serverVersion: info.version,
		activeSatKeysetId: keyset.id, denominationKeyDigest: demoDenominationKeyDigest(keyset.keys),
		denominationAmounts,
		inputFeePpk: 0, nuts,
	} }
}

async function mintLockedPool(options: {
	client: CashuMintClient; keyset: CashuKeyset; amount: number; locktime: number
	bidderPublicKey: string; committeePublicKey: string; refundPublicKey: string
}): Promise<CashuProof[]> {
	const parts = splitAmount(options.amount)
	const openings = parts.map(() => {
		const secret = buildDemoSigAllSecret({ nonce: randomSecretHex(), bidderPublicKey: options.bidderPublicKey,
			committeePublicKey: options.committeePublicKey, refundPublicKey: options.refundPublicKey, locktime: options.locktime })
		return blindMessage(secret)
	})
	const outputs = openings.map((opening, index) => ({ amount: parts[index]!, id: options.keyset.id, B_: opening.B_ }))
	const quote = await options.client.createMintQuote(options.amount)
	await options.client.awaitMintQuotePaid(quote.quote, { intervalMs: 100, timeoutMs: 10_000 })
	const minted = await options.client.mint(quote.quote, outputs)
	if (minted.signatures.length !== outputs.length) throw new Error('mint returned the wrong locked-proof count')
	const proofs = minted.signatures.map((signature, index) => unblindBlindedSignature(
		signature, openings[index]!, keysetPublicKey(options.keyset, signature.amount),
	))
	if (proofs.reduce((sum, proof) => sum + proof.amount, 0) !== options.amount
		|| proofs.some((proof) => !hasValidDleq(proof as never, options.keyset as never, { require: true }))) {
		throw new Error('newly minted locked pool failed exact DLEQ or amount verification')
	}
	return proofs
}

class FileRecipientJournal implements DemoRecipientPrivateJournalPort<OpeningWire> {
	constructor(private readonly path: string) {}
	async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() }
	async #all(): Promise<Record<string, DemoRecipientPrivateRecord<OpeningWire>>> {
		try { return JSON.parse(await readFile(this.path, 'utf8')) as Record<string, DemoRecipientPrivateRecord<OpeningWire>> }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
			throw error
		}
	}
	async #save(value: Record<string, DemoRecipientPrivateRecord<OpeningWire>>): Promise<void> {
		const temporary = `${this.path}.${randomUUID()}.tmp`
		await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
		await rename(temporary, this.path); await chmod(this.path, 0o600)
	}
	async load(scope: string) { return structuredClone((await this.#all())[scope] ?? null) }
	async savePrepared(scope: string, record: DemoRecipientPrivateRecord<OpeningWire>) {
		const values = await this.#all(); const prior = values[scope]
		if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(record)) throw new Error('recipient journal scope conflict')
		values[scope] = structuredClone(record); await this.#save(values)
	}
	async markImported(scope: string, requestDigest: string, responseDigest: string) {
		const values = await this.#all(); const record = values[scope]
		if (record === undefined || record.requestDigest !== requestDigest) throw new Error('recipient journal import conflict')
		if (record.importedResponseDigest !== undefined && record.importedResponseDigest !== responseDigest) throw new Error('recipient response conflict')
		record.importedResponseDigest = responseDigest; await this.#save(values)
	}
}

interface RecipientPlan {
	intent: DemoRecipientIntent
	request: DemoRecipientCoordinatorRequest
	journalPath: string
}

async function recipientPlan(options: {
	path: string; network: string; chainId: string; auctionId: string; operationId: string
	role: 'winner_settlement' | 'refund'; recipientPrivateKey: Uint8Array; keyset: CashuKeyset; amount: number
}): Promise<RecipientPlan> {
	const recipientPublicKey = compressed(options.recipientPrivateKey)
	const intent: DemoRecipientIntent = {
		schema: 'COCO_DEMO_RECIPIENT_INTENT_V1', network: options.network, chainId: options.chainId,
		auctionId: options.auctionId, operationId: options.operationId, role: options.role,
		mintUrl: MINT, unit: 'sat', recipientPublicKey, amounts: splitAmount(options.amount),
	}
	const journal = new FileRecipientJournal(options.path)
	const request = await prepareDemoSigAllRecipientOutputs({
		intent, keyset: { id: options.keyset.id, unit: options.keyset.unit, keys: { ...options.keyset.keys } },
		roleBinding: {
			async assertWinnerRecipient(binding) {
				if (options.role !== 'winner_settlement' || binding.recipientPublicKey !== recipientPublicKey) throw new Error('winner recipient binding changed')
			},
			async assertRefundRecipient(binding) {
				if (options.role !== 'refund' || binding.recipientPublicKey !== recipientPublicKey) throw new Error('refund recipient binding changed')
			},
		},
		signer: {
			async signCapability(request) {
				if (request.recipientPublicKey !== recipientPublicKey || request.operationId !== options.operationId || request.role !== options.role) {
					throw new Error('recipient signer scope changed')
				}
				return sign(request.digest, options.recipientPrivateKey)
			},
		},
		outputFactory: {
			async createRecipientOwnedOutput(request) {
				const opening = blindMessage(randomSecretHex())
				return {
					message: { amount: request.amount, id: request.keysetId, B_: opening.B_ },
					privateOpeningRef: { secret: opening.secret, r: opening.r.toString(16), B_: opening.B_ },
				}
			},
		},
		journal,
	})
	return { intent, request, journalPath: options.path }
}

interface BidPackage {
	bundle: DemoMaintainerExactTemplateBundle
	unsignedReceipt: ReturnType<typeof prepareDemoIntegratedFundingReceipt>
	refundPlan: RecipientPlan
	proofRefs: string[]
}

async function prepareBidPackage(options: {
	root: string; network: string; chainId: string; auctionId: string; amount: number; replacesBidId: string
	nowSeconds: number; originalEndTime: number; certifiedEndTime: number; actorPrivate: Uint8Array
	bidderPrivate: Uint8Array; refundPrivate: Uint8Array; sellerRoot: HDKey; keyset: CashuKeyset
	mintSeal: DemoMintCapabilitySeal; dkg: DemoThreshold3EphemeralKeyset; inputs: CashuProof[]
}): Promise<BidPackage> {
	const operationId = randomBytes(32).toString('hex')
	const bidderPublicKey = compressed(options.bidderPrivate)
	const refundPublicKey = compressed(options.refundPrivate)
	const actor = xonly(options.actorPrivate)
	const timing = demoIntegratedTiming(options.originalEndTime, options.certifiedEndTime)
	const derivationPath = 'm/1/2/3/4/5'
	const seller = options.sellerRoot.derive(derivationPath)
	if (seller.privateKey === null) throw new Error('seller child private key is absent')
	const winnerPlan = await recipientPlan({
		path: join(options.root, `${operationId}.winner-recipient.json`), network: options.network, chainId: options.chainId,
		auctionId: options.auctionId, operationId, role: 'winner_settlement', recipientPrivateKey: seller.privateKey,
		keyset: options.keyset, amount: options.amount,
	})
	const refundPlan = await recipientPlan({
		path: join(options.root, `${operationId}.refund-recipient.json`), network: options.network, chainId: options.chainId,
		auctionId: options.auctionId, operationId, role: 'refund', recipientPrivateKey: options.refundPrivate,
		keyset: options.keyset, amount: options.amount,
	})
	const participants = options.dkg.participants.map((participant) => ({
		identifier: participant.participantId, verifyingShare: participant.verifyingShare,
	})) as DemoMaintainerExactBranchTemplate['participants']
	const common = {
		schema: 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V1' as const, network: options.network, chainId: options.chainId,
		auctionId: options.auctionId, operationId, bidId: operationId, bidEventId: operationId, bidderActorId: actor,
		amount: options.amount, inputFee: 0, mintUrl: MINT, unit: 'sat' as const, locktime: timing.locktime,
		validUntil: timing.maximumEndTime, closeTime: timing.certifiedEndTime, settlementWindowSeconds: 600,
		sellerP2pkXpub: options.sellerRoot.publicExtendedKey, bidderDerivationPath: derivationPath,
		bidderPublicKey, refundPublicKey, committeePublicKey: options.dkg.committeePublicKey,
		committeeKeysetId: options.dkg.committeeKeysetId, committeeKeysetVersion: options.dkg.committeeKeysetVersion,
		threshold: 3 as const, participants, mintSeal: structuredClone(options.mintSeal),
		inputs: options.inputs.map((proof) => structuredClone(proof)),
	}
	const makeTemplate = (role: 'winner_settlement' | 'refund', plan: RecipientPlan): DemoMaintainerExactBranchTemplate => {
		const template: DemoMaintainerExactBranchTemplate = {
			...common, role, recipientPublicKey: plan.intent.recipientPublicKey,
			outputs: plan.request.outputs.map((output) => ({ ...output })),
			recipientCapability: { ...plan.request.capability }, templateDigest: '', cashuSigAllDigest: '', bidderMainSignature: '',
		}
		template.cashuSigAllDigest = demoCashuSigAllDigest(template.inputs, template.outputs)
		template.bidderMainSignature = sign(template.cashuSigAllDigest, options.bidderPrivate)
		if (role === 'refund') template.refundSignature = sign(template.cashuSigAllDigest, options.refundPrivate)
		template.templateDigest = demoMaintainerExactTemplateDigest(template)
		return template
	}
	const winner = makeTemplate('winner_settlement', winnerPlan)
	const refund = makeTemplate('refund', refundPlan)
	const bundle: DemoMaintainerExactTemplateBundle = {
		schema: 'COCO_DEMO_MAINTAINER_TEMPLATE_BUNDLE_V1', preparedAt: options.nowSeconds,
		winner, refund,
		actorWinnerAuthorization: {
			actorId: winner.bidderActorId, packageDigest: winner.templateDigest,
			signature: sign(winner.templateDigest, options.actorPrivate),
		},
		actorReturnAuthorization: {
			actorId: winner.bidderActorId, packageDigest: refund.templateDigest,
			signature: sign(refund.templateDigest, options.actorPrivate),
		},
		bundleDigest: '', actorBundleSignature: '', bidderBundleSignature: '',
	}
	bundle.bundleDigest = demoMaintainerTemplateBundleDigest(bundle)
	bundle.actorBundleSignature = sign(bundle.bundleDigest, options.actorPrivate)
	bundle.bidderBundleSignature = sign(bundle.bundleDigest, options.bidderPrivate)
	const proofRefs = options.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
	const terms: DemoIntegratedFundingReceiptTerms = {
		schema: 'PlebeianAuctionsPOCIntegratedFundingV3', auth_network_id: options.network, chain_id: options.chainId,
		mint_url: MINT, auction_id: options.auctionId, bidder: actor, bid_amount: options.amount,
		pool_amount: options.amount, replaces_bid_id: options.replacesBidId, funding_operation_id: operationId,
		attested_at: options.nowSeconds, expires_at: options.nowSeconds + 240, proof_state_refs: proofRefs,
		active_keyset_id: options.keyset.id, input_fee_ppk: 0, locktime: timing.locktime,
		bidder_public_key: bidderPublicKey, refund_public_key: refundPublicKey,
		committee_public_key: options.dkg.committeePublicKey, committee_keyset_id: options.dkg.committeeKeysetId,
		committee_keyset_version: options.dkg.committeeKeysetVersion, dkg_run_id: options.dkg.dkgRunId,
		public_key_package_sha256: options.dkg.publicKeyPackageSha256, signer_roster_digest: options.dkg.signerRosterDigest,
		winner_package_digest: winner.templateDigest, return_package_digest: refund.templateDigest,
		return_cashu_sigall_digest: refund.cashuSigAllDigest, bidder_return_signature: refund.bidderMainSignature,
	}
	const fundingDigest = demoIntegratedFundingBundleDigest(terms)
	return { bundle, unsignedReceipt: prepareDemoIntegratedFundingReceipt(terms, sign(fundingDigest, options.actorPrivate)), refundPlan, proofRefs }
}

async function thresholdSigAllSignature(options: {
	dkg: DemoThreshold3EphemeralKeyset
	claim: Parameters<typeof createDemoMaintainerThreshold3ProcessComposition>[0]['authorityClaim']
	authorityStore: DemoIntegratedAuthoritySqliteStore
	policy: DemoFrostParticipantPolicyPackage
	request: DemoMaintainerFederationRequest
	participants: Parameters<typeof createDemoMaintainerThreshold3ProcessComposition>[0]['participants']
}): Promise<{ signature: string; operationRoot: string; participantIds: number[]; transcriptHash: string }> {
	const composition = await createDemoMaintainerThreshold3ProcessComposition({
		request: structuredClone(options.request), policy: structuredClone(options.policy),
		authorityClaim: structuredClone(options.claim), authorityStore: options.authorityStore,
		participants: options.participants,
		dkgRunId: options.dkg.dkgRunId, publicKeyPackageSha256: options.dkg.publicKeyPackageSha256,
		signerRosterDigest: options.dkg.signerRosterDigest, binaryPath: PARTICIPANT_BINARY,
		publicKeyPackagePath: options.dkg.publicKeyPackagePath, scratchParent: ROOT,
		processTimeoutMs: 20_000, federationTimeoutMs: 25_000,
	})
	const result = await composition.federation.authorize(structuredClone(options.request))
	if (!schnorr.verify(hexToBytes(result.signature), hexToBytes(options.policy.cashuSigAllDigest), hexToBytes(options.dkg.committeePublicKey.slice(2)))) {
		throw new Error('aggregated SIG_ALL FROST signature is invalid')
	}
	return {
		signature: result.signature, operationRoot: composition.executionBinding.frostOperationRoot,
		participantIds: result.participantIds, transcriptHash: result.transcriptHash,
	}
}

async function checkProofStates(proofs: CashuProof[]) {
	const Ys = proofs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true)))
	const response = await fetch(`${MINT}/v1/checkstate`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Ys }),
	})
	if (!response.ok) throw new Error(`NUT-07 failed with HTTP ${response.status}`)
	return exactDemoNut07Result(Ys, await response.json())
}

async function spendLoseAndRecover(options: {
	template: DemoMaintainerExactBranchTemplate; thresholdSignature: string; plan: RecipientPlan; keyset: CashuKeyset
	onBoundary?(state: 'attempting' | 'ambiguous' | 'recovered' | 'recipient_imported'): Promise<void>
}) {
	const inputs = options.template.inputs.map((proof) => structuredClone(proof))
	inputs[0]!.witness = JSON.stringify({ signatures: [options.template.bidderMainSignature, options.thresholdSignature] })
	let swapCalls = 0
	await options.onBoundary?.('attempting')
	let responseWasLost = false
	try {
		swapCalls++
		await fetch(`${FAULT_MINT}/v1/swap`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ inputs, outputs: options.template.outputs }),
		})
	} catch {
		responseWasLost = true
	}
	if (!responseWasLost) throw new Error('fault proxy unexpectedly delivered the committed swap response')
	// Deliberately discard the returned signatures. Recovery begins only from
	// the exact persisted output plan and recipient-private opening journal.
	await options.onBoundary?.('ambiguous')
	const inputStates = await checkProofStates(options.template.inputs)
	if (inputStates.states.some((state) => state !== 'SPENT')) throw new Error('mint committed response loss without spending every exact input')
	const restoredResponse = await fetch(`${MINT}/v1/restore`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outputs: options.template.outputs }),
	})
	if (!restoredResponse.ok) throw new Error(`NUT-09 restore failed with HTTP ${restoredResponse.status}`)
	const restored = await restoredResponse.json() as { outputs?: Array<BlindedMessage & { C_?: unknown }>; signatures?: BlindedSignature[] }
	const outputsAreExact = Array.isArray(restored.outputs)
		&& restored.outputs.length === options.template.outputs.length
		&& restored.outputs.every((output, index) => {
			const expected = options.template.outputs[index]!
			const keys = Object.keys(output).sort()
			// Nutshell's PostRestoreResponse serializes the BlindedMessage model's
			// optional C_ field as null. It is not part of the request identity.
			return (JSON.stringify(keys) === JSON.stringify(['B_', 'C_', 'amount', 'id']) && output.C_ === null
				|| JSON.stringify(keys) === JSON.stringify(['B_', 'amount', 'id']))
				&& output.amount === expected.amount && output.id === expected.id && output.B_ === expected.B_
		})
	if (!outputsAreExact || !Array.isArray(restored.signatures)
		|| restored.signatures.length !== options.template.outputs.length) throw new Error('NUT-09 did not restore the exact requested outputs')
	await options.onBoundary?.('recovered')
	const coordinatorResponse: DemoRecipientCoordinatorResponse = {
		schema: 'COCO_DEMO_RECIPIENT_RESPONSE_V1', operationId: options.template.operationId,
		recipientCapabilityDigest: demoRecipientCapabilityDigest(options.plan.request.capability),
		signatures: restored.signatures,
	}
	let ownedProofs: CashuProof[] = []
	const journal = new FileRecipientJournal(options.plan.journalPath)
	const walletPath = `${options.plan.journalPath}.wallet.json`
	const receipt = await acceptDemoSigAllRecipientResponse({
		intent: options.plan.intent,
		keyset: { id: options.keyset.id, unit: options.keyset.unit, keys: { ...options.keyset.keys } },
		response: coordinatorResponse,
		roleBinding: {
			async assertWinnerRecipient() { throw new Error('outbid return cannot import as a winner') },
			async assertRefundRecipient(binding) {
				if (binding.recipientPublicKey !== options.plan.intent.recipientPublicKey) throw new Error('refund recipient changed')
			},
		},
		unblinder: {
			async unblindExact(request) {
				return request.signatures.map((signature, index) => {
					const opening = request.privateOpeningRefs[index]!
					const blinding: BlindingData = { secret: opening.secret, r: BigInt(`0x${opening.r}`), B_: opening.B_ }
					return unblindBlindedSignature(signature, blinding, keysetPublicKey(options.keyset, signature.amount))
				})
			},
		},
		verifier: {
			async verifyExact(request) {
				const proofs = request.unblindedRef
				if (proofs.reduce((sum, proof) => sum + proof.amount, 0) !== options.template.amount
					|| proofs.some((proof) => !hasValidDleq(proof as never, options.keyset as never, { require: true }))) {
					throw new Error('recipient recovered proofs fail exact amount or DLEQ verification')
				}
				return proofs
			},
		},
		wallet: {
			async importVerified(request) {
				let prior: { idempotencyKey: string; proofs: CashuProof[] } | undefined
				try { prior = JSON.parse(await readFile(walletPath, 'utf8')) as typeof prior }
				catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
				if (prior !== undefined && (prior.idempotencyKey !== request.idempotencyKey
					|| JSON.stringify(prior.proofs) !== JSON.stringify(request.verifiedRef))) throw new Error('recipient wallet replay conflict')
				if (prior === undefined) await replacePrivateJson(walletPath, {
					idempotencyKey: request.idempotencyKey, proofs: request.verifiedRef,
				})
				ownedProofs = (prior?.proofs ?? request.verifiedRef).map((proof) => structuredClone(proof))
			},
		},
		journal,
	})
	await options.onBoundary?.('recipient_imported')
	const recipientStates = await checkProofStates(ownedProofs)
	if (recipientStates.states.some((state) => state !== 'UNSPENT')) throw new Error('recipient imported proofs are not all exactly UNSPENT')
	return { receiptAmount: receipt.amount, swapCalls, restoredCount: restored.signatures.length, inputStates, recipientStates, ownedProofs }
}

test('unified local Comet, independent policy, real FROST and recovered fake-mint outbid return', async () => {
	if (!ROOT.startsWith('/tmp/plebeian-friday-integrated.') || !POC_BINARY.startsWith(`${ROOT}/`)
		|| FAULT_MINT !== 'http://127.0.0.1:3340'
		|| !/^[0-9a-f]{40}$/.test(SOURCE_COMMIT)
		|| !EVIDENCE.startsWith(resolve(import.meta.dir, '../../evidence/') + '/')) {
		throw new Error('live integrated harness requires the exact throwaway wrapper environment')
	}
	const workers: DemoAdmissionParticipantProcess[] = []
	const terminalTransports: Array<ReturnType<typeof createDemoFrostStdioProcessTransport>> = []
	let localDemo: ManagedChild | undefined
	const databases: Database[] = []
	try {
		const dkg = await provisionEphemeralDemoThreshold3({
			root: join(ROOT, 'dkg'), participantBinaryPath: PARTICIPANT_BINARY, inspectorBinaryPath: INSPECTOR_BINARY,
			dkgRunId: `friday-integrated-${randomUUID()}`, committeeKeysetId: `friday-committee-${randomUUID()}`,
			committeeKeysetVersion: '1', commandTimeoutMs: 30_000,
		})
		localDemo = Bun.spawn([
			POC_BINARY, 'local-demo', '--home', join(ROOT, 'network'), '--listen', '127.0.0.1:18080',
			'--committee-public-key', dkg.committeePublicKey,
		], { stdout: 'pipe', stderr: 'pipe' })
		const initialPanel = await waitFor('four-validator local demo', 60_000, async () => {
			if (localDemo?.exitCode !== null) throw new Error(`local demo exited ${localDemo?.exitCode}`)
			const response = await fetch(`${SITE}/api/validators`)
			return response.ok ? response.json() : null
		}, (value: any) => Array.isArray(value?.validators) && value.validators.length === 4
			&& value.validators.every((validator: any) => validator.online && validator.commit_signatures === 4))

		const manifest = JSON.parse(await readFile(join(ROOT, 'network/network.json'), 'utf8')) as { chain_id: string }
		const chainId = manifest.chain_id
		if (!/^[A-Za-z0-9_-]{1,160}$/.test(chainId)) throw new Error('local chain id is malformed')
		const status = await (await fetch(`${RPC}/status`)).json() as any
		const height = Number(status.result?.sync_info?.latest_block_height)
		const block = await (await fetch(`${RPC}/block?height=${height}`)).json() as any
		const validatorsHash = String(block.result?.block?.header?.validators_hash ?? '').toLowerCase()
		if (!HEX_32.test(validatorsHash)) throw new Error('local validator roster hash is malformed')
		const genesisHash = bytesToHex(sha256(new Uint8Array(await Bun.file(join(ROOT, 'network/genesis.json')).arrayBuffer())))

		const sellerPrivate = hexToBytes(generateSchnorrKeypair().privateKeyHex)
		const firstActorPrivate = hexToBytes(generateSchnorrKeypair().privateKeyHex)
		const secondActorPrivate = hexToBytes(generateSchnorrKeypair().privateKeyHex)
		const firstBidder = generateSchnorrKeypair(), firstRefund = generateSchnorrKeypair()
		const secondBidder = generateSchnorrKeypair(), secondRefund = generateSchnorrKeypair()
		const sellerRoot = HDKey.fromMasterSeed(randomBytes(32))
		const sellerPaymentPublicKey = sellerRoot.derive('m/1/2/3/4/5').publicKey
		if (sellerPaymentPublicKey === null) throw new Error('seller payment public key is absent')
		const auctionId = `frost-friday-${Date.now()}`
		const create = await post('/api/event', await signedEvent(sellerPrivate, 28640, {
			auction_id: auctionId, title: 'Integrated threshold fake-money lot', description: 'local fake-only evidence',
			duration_seconds: 300, starting_bid: 100, min_increment: 100, reserve: 0,
			funding_mode: 'threshold_sigall_v1', seller_coco_payment_public_key: bytesToHex(sellerPaymentPublicKey),
		}))
		expect(create.status, JSON.stringify(create.body)).toBe(200)
		const reader = createLoopbackCometReader(RPC)
		const state = await waitFor('threshold auction commit', 30_000, () => reader.readCurrentState(),
			(value) => value.state.auctions?.[auctionId]?.funding_mode === 'threshold_sigall_v1')
		const auction = state.state.auctions[auctionId]!
		if (!Number.isSafeInteger(auction.original_end_time) || !Number.isSafeInteger(auction.end_time)) throw new Error('auction committed timing is absent')

		const client = new CashuMintClient({ mintUrl: MINT })
		const { keyset, seal } = await mintFacts(client)
		const timing = demoIntegratedTiming(auction.original_end_time!, auction.end_time!)
		const firstInputs = (await mintLockedPool({
			client, keyset, amount: 1000, locktime: timing.locktime,
			bidderPublicKey: firstBidder.publicKeyHex, committeePublicKey: dkg.committeePublicKey,
			refundPublicKey: firstRefund.publicKeyHex,
		})).sort((left, right) => bytesToHex(proofPoint(left).toBytes(true)).localeCompare(bytesToHex(proofPoint(right).toBytes(true))))
		const secondInputs = (await mintLockedPool({
			client, keyset, amount: 1200, locktime: timing.locktime,
			bidderPublicKey: secondBidder.publicKeyHex, committeePublicKey: dkg.committeePublicKey,
			refundPublicKey: secondRefund.publicKeyHex,
		})).sort((left, right) => bytesToHex(proofPoint(left).toBytes(true)).localeCompare(bytesToHex(proofPoint(right).toBytes(true))))
		const firstNow = Math.floor(Date.now() / 1000)
		const first = await prepareBidPackage({
			root: ROOT, network: chainId, chainId, auctionId, amount: 1000, replacesBidId: '', nowSeconds: firstNow,
			originalEndTime: auction.original_end_time!, certifiedEndTime: auction.end_time!, actorPrivate: firstActorPrivate,
			bidderPrivate: hexToBytes(firstBidder.privateKeyHex), refundPrivate: hexToBytes(firstRefund.privateKeyHex),
			sellerRoot, keyset, mintSeal: seal, dkg, inputs: firstInputs,
		})

		const workerPath = resolve(import.meta.dir, 'demo-integrated-admission-worker.ts')
		for (const participantId of [1, 2, 3, 4] as const) {
			workers.push(createDemoAdmissionParticipantProcess({
				participantId, command: [process.execPath, workerPath], env: {
					// The worker needs no host credentials or user configuration. Keep
					// the subprocess environment to the exact throwaway policy pins.
					FRIDAY_PARTICIPANT_ID: String(participantId), FRIDAY_COMET_RPC: RPC,
					FRIDAY_COMET_VALIDATORS_HASH: validatorsHash, FRIDAY_CHAIN_ID: chainId,
					FRIDAY_PROOF_USE_DB: join(ROOT, `policy-${participantId}.sqlite3`),
				},
			}))
		}
		const unavailableWorkerPid = workers[3]!.processId
		await workers[3]!.close()

		const sessionsDb = new Database(join(ROOT, 'admission-sessions.sqlite3'), { create: true, strict: true }); databases.push(sessionsDb)
		if (dkg.participants.length !== 4) throw new Error('dealerless DKG did not return an exact four-participant roster')
		const admissionParticipants: Parameters<typeof createDemoFrostThreshold3AdmissionPort>[0]['participants'] = [
			{ ...dkg.participants[0]!, policyService: workers[0]! },
			{ ...dkg.participants[1]!, policyService: workers[1]! },
			{ ...dkg.participants[2]!, policyService: workers[2]! },
			{ ...dkg.participants[3]!, policyService: workers[3]! },
		]
		const committee = createDemoFrostThreshold3AdmissionPort({
			binaryPath: PARTICIPANT_BINARY, publicKeyPackagePath: dkg.publicKeyPackagePath,
			scratchParent: ROOT,
			participants: admissionParticipants,
			sessions: new DemoAdmissionSqliteSessionStore(sessionsDb),
		})
		const privateDb = new Database(join(ROOT, 'maintainer-private.sqlite3'), { create: true, strict: true }); databases.push(privateDb)
		const offlineStore = new DemoMaintainerEncryptedSqliteStore(privateDb, randomBytes(32), () => Math.floor(Date.now() / 1000))
		const firstConsensus = createDemoCometBidConsensus({
			reader, broadcaster: createLoopbackCometBidBroadcaster(RPC), signer: signer(firstActorPrivate),
			chainId, validatorsHash, nowSeconds: () => Math.floor(Date.now() / 1000),
		})
		const dkgBinding = { dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256, signerRosterDigest: dkg.signerRosterDigest }
		const firstAdmission = await admitDemoIntegratedThreshold3Bid({
			unsignedReceipt: first.unsignedReceipt, bundle: first.bundle, nowSeconds: firstNow, dkgBinding,
			participants: workers as [DemoAdmissionParticipantProcess, DemoAdmissionParticipantProcess, DemoAdmissionParticipantProcess, DemoAdmissionParticipantProcess],
			committee, offlineStore, consensus: firstConsensus, policyTimeoutMs: 15_000,
		})
		expect(firstAdmission.commit.disposition).toEqual({ kind: 'active' })
		expect(firstAdmission.committeeAuthorization.participantIds).toEqual([1, 2, 3])

		const offline = await post('/api/admin/offline', { slot: 4 })
		expect(offline.status, JSON.stringify(offline.body)).toBe(200)
		const faultPanel = await waitFor('validator four unavailable', 20_000, async () => (await (await fetch(`${SITE}/api/validators`)).json()),
			(value: any) => Array.isArray(value?.validators) && value.validators.filter((validator: any) => validator.online).length === 3
				&& value.validators.filter((validator: any) => validator.online).every((validator: any) => validator.commit_signatures === 3))

		const secondNow = Math.floor(Date.now() / 1000)
		const second = await prepareBidPackage({
			root: ROOT, network: chainId, chainId, auctionId, amount: 1200, replacesBidId: firstAdmission.commit.bidId,
			nowSeconds: secondNow, originalEndTime: auction.original_end_time!, certifiedEndTime: auction.end_time!,
			actorPrivate: secondActorPrivate, bidderPrivate: hexToBytes(secondBidder.privateKeyHex),
			refundPrivate: hexToBytes(secondRefund.privateKeyHex), sellerRoot, keyset, mintSeal: seal, dkg, inputs: secondInputs,
		})
		const secondAdmission = await admitDemoIntegratedThreshold3Bid({
			unsignedReceipt: second.unsignedReceipt, bundle: second.bundle, nowSeconds: secondNow, dkgBinding,
			participants: workers as [DemoAdmissionParticipantProcess, DemoAdmissionParticipantProcess, DemoAdmissionParticipantProcess, DemoAdmissionParticipantProcess],
			committee, offlineStore,
			consensus: createDemoCometBidConsensus({
				reader, broadcaster: createLoopbackCometBidBroadcaster(RPC), signer: signer(secondActorPrivate),
				chainId, validatorsHash, nowSeconds: () => Math.floor(Date.now() / 1000),
			}), policyTimeoutMs: 15_000,
		})
		expect(secondAdmission.commit.disposition).toEqual({ kind: 'active' })
		expect(secondAdmission.commit.commits).toHaveLength(3)
		const displacementVerifier = createDemoCometDisplacementVerifier({
			reader, network: chainId, chainId, genesisHash, validatorRosterVersion: 'local-v1', validatorsHash,
			committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
			dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
			signerRosterDigest: dkg.signerRosterDigest,
		})
		const certificate = await displacementVerifier.verifyAndDerive({
			network: chainId, chainId, genesisHash, validatorRosterVersion: 'local-v1', auctionId,
			replacementBidEventId: secondAdmission.commit.bidId, displacementHeight: secondAdmission.commit.height,
		})
		expect(certificate.displacedBidId).toBe(firstAdmission.commit.bidId)
		expect(certificate.replacementBidId).toBe(secondAdmission.commit.bidId)
		const authorityDb = new Database(join(ROOT, 'integrated-authority.sqlite3'), { create: true, strict: true }); databases.push(authorityDb)
		const authorityStore = new DemoIntegratedAuthoritySqliteStore(authorityDb)
		const claim = await authorizeDemoCooperativeOutbidReturn({
			certificate, template: first.bundle.refund, store: authorityStore,
			nowSeconds: certificate.commits[2].blockTime,
			displacementVerifier: { async verifyAndDerive() { return structuredClone(certificate) } },
		})
		let lifecycle: Awaited<ReturnType<typeof authorityStore.readLifecycle>> = await authorityStore.readLifecycle(claim.operationId)
		if (lifecycle === null || lifecycle.status !== 'outbid_return_pending') throw new Error('durable outbid lifecycle was not created')
		const operationJournalPath = join(ROOT, `${claim.operationId}.mint-operation.json`)
		const signedBidEvidence = await deriveDemoCometSignedBidEvidence({
			reader, validatorsHash, minimumHeight: certificate.commits[2].height,
			fundingOperationId: claim.operationId,
			deposits: first.bundle.refund.inputs.map((proof) => ({
				proofStateRef: bytesToHex(proofPoint(proof).toBytes(true)), amount: proof.amount, keysetId: proof.id,
			})),
			sellerRecipientPublicKey: first.bundle.winner.recipientPublicKey,
		})
		const policy: DemoFrostParticipantPolicyPackage = {
			schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_V1', network: claim.network, chainId: claim.chainId,
			auctionId: claim.auctionId, operationId: claim.operationId, bidId: claim.displacedBidId,
			bidEventId: claim.displacedBidId, bidderActorId: certificate.displacedBidderActorId,
			role: 'refund', outcomeHeight: certificate.commits[2].height,
			appStateHash: certificate.commits[2].appHash, amount: claim.poolAmount,
			inputFee: 0, inputFeePpk: 0, mintUrl: first.bundle.refund.mintUrl, unit: 'sat',
			activeKeysetId: first.bundle.refund.mintSeal.activeSatKeysetId, locktime: first.bundle.refund.locktime,
			bidderPublicKey: first.bundle.refund.bidderPublicKey, committeePublicKey: first.bundle.refund.committeePublicKey,
			sellerRecipientPublicKey: first.bundle.winner.recipientPublicKey,
			recipientPublicKey: first.bundle.refund.recipientPublicKey,
			deposits: first.bundle.refund.inputs.map((proof) => ({
				proofStateRef: bytesToHex(proofPoint(proof).toBytes(true)), amount: proof.amount, keysetId: proof.id,
			})),
			committeeLockedProofs: first.bundle.refund.inputs.map((proof) => ({
				amount: proof.amount,
				id: proof.id,
				secret: proof.secret,
				C: proof.C,
				...(proof.dleq === undefined ? {} : { dleq: { ...proof.dleq } }),
			})),
			outputs: first.bundle.refund.outputs.map((output) => ({ ...output })),
			recipientCapability: { ...first.bundle.refund.recipientCapability },
			packageDigest: first.bundle.refund.templateDigest,
			cashuSigAllDigest: first.bundle.refund.cashuSigAllDigest,
			actorPackageAuthorization: {
				actorId: certificate.displacedBidderActorId, packageDigest: first.bundle.refund.templateDigest,
				signature: sign(first.bundle.refund.templateDigest, firstActorPrivate),
			},
			certifiedClosure: {
				evidenceDigest: demoIntegratedDisplacementFinalityDigest(certificate),
				evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V1', source: 'participant-local' },
			},
			signedBid: {
				evidenceDigest: signedBidEvidence.evidenceDigest,
				evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1', source: 'participant-local' },
			},
		}
		const policyPackageDigest = demoFrostParticipantPolicyDigest(policy)
		const committeeLockedProofsDigest = demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs)
		const federationRequest: DemoMaintainerFederationRequest = {
			schema: 'COCO_DEMO_FROST_REQUEST_V1', threshold: 3,
			sessionId: randomBytes(32).toString('hex'), packageDigest: policy.packageDigest,
			cashuSigAllDigest: policy.cashuSigAllDigest, committeePublicKey: dkg.committeePublicKey,
			committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
			participants: dkg.participants.map((participant) => ({
				identifier: participant.participantId, verifyingShare: participant.verifyingShare,
			})),
			policyPackageDigest, closureEvidenceDigest: policy.certifiedClosure.evidenceDigest,
			signedBidEvidenceDigest: policy.signedBid.evidenceDigest, committeeLockedProofsDigest,
		}
		const terminalWorkerPath = resolve(import.meta.dir, 'demo-integrated-terminal-worker.ts')
		const terminalRefusals: string[] = []
		const terminalEnrollmentPermits = await Promise.all(dkg.participants.map(async (participant) => {
			const path = join(ROOT, `terminal-enrollment-${participant.participantId}.json`)
			await replacePrivateJson(path, demoDispositionEnrollmentPermit({
				participantId: participant.participantId, dkgRunId: dkg.dkgRunId,
				publicKeyPackageSha256: dkg.publicKeyPackageSha256, signerRosterDigest: dkg.signerRosterDigest,
			}))
			return path
		}))
		const terminalParticipants = dkg.participants.map((participant): DemoFrostProcessParticipant => {
			const transport = createDemoFrostStdioProcessTransport({
				command: [process.execPath, terminalWorkerPath], restartCounter: 1,
				enrollment: {
					participantId: participant.participantId,
					processIdentity: `friday-terminal-participant-${participant.participantId}`,
					stateDirectory: participant.stateDirectory, verifyingShare: participant.verifyingShare,
				},
				env: {
					PATH: process.env.PATH, TMPDIR: ROOT, FRIDAY_PARTICIPANT_ID: String(participant.participantId),
					FRIDAY_COMET_RPC: RPC, FRIDAY_NETWORK: chainId, FRIDAY_CHAIN_ID: chainId,
					FRIDAY_GENESIS_HASH: genesisHash, FRIDAY_COMET_VALIDATORS_HASH: validatorsHash,
					FRIDAY_VALIDATOR_ROSTER_VERSION: 'local-v1', FRIDAY_DKG_RUN_ID: dkg.dkgRunId,
					FRIDAY_COMMITTEE_KEYSET_ID: dkg.committeeKeysetId,
					FRIDAY_COMMITTEE_KEYSET_VERSION: dkg.committeeKeysetVersion,
					FRIDAY_PUBLIC_PACKAGE_SHA256: dkg.publicKeyPackageSha256,
					FRIDAY_SIGNER_ROSTER_DIGEST: dkg.signerRosterDigest,
					FRIDAY_REPLACEMENT_BID_EVENT_ID: certificate.replacementBidEventId,
					FRIDAY_DISPLACEMENT_HEIGHT: String(certificate.commits[0].height),
					FRIDAY_SIGNER_CONFIG: participant.configPath, FRIDAY_SIGNER_STATE: participant.stateDirectory,
					FRIDAY_SIGNER_BINARY: PARTICIPANT_BINARY, FRIDAY_SIGNER_SCRATCH: ROOT,
					FRIDAY_TERMINAL_PROOF_USE_DB: join(ROOT, `terminal-proof-use-${participant.participantId}.sqlite3`),
					FRIDAY_TERMINAL_ANCHOR_DB: join(ROOT, `terminal-anchor-${participant.participantId}.sqlite3`),
					FRIDAY_TERMINAL_ENROLLMENT_PERMIT: terminalEnrollmentPermits[participant.participantId - 1],
				},
				onWorkerRefusal(message) {
					terminalRefusals.push(`participant-${participant.participantId}: ${message}`)
				},
			})
			terminalTransports.push(transport)
			return { enrollment: {
				participantId: participant.participantId,
				processIdentity: `friday-terminal-participant-${participant.participantId}`,
				stateDirectory: participant.stateDirectory, verifyingShare: participant.verifyingShare,
			}, transport }
		}) as Parameters<typeof createDemoMaintainerThreshold3ProcessComposition>[0]['participants']
		const unavailableTerminalPolicyPid = terminalTransports[3]!.processId
		terminalTransports[3]!.close(); await terminalTransports[3]!.waitClosed()
		let threshold: Awaited<ReturnType<typeof thresholdSigAllSignature>>
		try {
			threshold = await thresholdSigAllSignature({
				dkg, claim, authorityStore, policy, request: federationRequest,
				participants: terminalParticipants,
			})
		} catch (error) {
			const diagnostic = terminalRefusals.length === 0 ? 'none captured' : terminalRefusals.join(' | ')
			throw new Error(`terminal signer policy failed (${diagnostic})`, { cause: error })
		}
		expect(threshold.participantIds).toEqual([1, 2, 3])
		const recovered = await spendLoseAndRecover({
			template: first.bundle.refund, thresholdSignature: threshold.signature, plan: first.refundPlan, keyset,
			async onBoundary(state) {
				const transition = state === 'attempting'
					? { expected: 'outbid_return_pending' as const, next: 'execution_pending' as const }
					: state === 'ambiguous'
						? { expected: 'execution_pending' as const, next: 'mint_unknown' as const }
						: state === 'recovered'
							? { expected: 'mint_unknown' as const, next: 'recipient_pending' as const }
							: { expected: 'recipient_pending' as const, next: 'recipient_imported' as const }
				await replacePrivateJson(operationJournalPath, {
					schema: 'PlebeianFridayIntegratedMintOperationV1', state, operation_id: claim.operationId,
					authority_root: claim.operationRoot, frost_root: threshold.operationRoot,
					request_digest: first.bundle.refund.cashuSigAllDigest,
					recipient_capability_digest: demoRecipientCapabilityDigest(first.bundle.refund.recipientCapability),
					outputs: first.bundle.refund.outputs.map((output) => ({ ...output })),
				})
				lifecycle = await authorityStore.transitionLifecycle({
					operationId: claim.operationId, expectedRevision: lifecycle!.revision,
					expectedStatus: transition.expected, nextStatus: transition.next, evidenceDigest: digest([state, claim.operationRoot]),
				})
			},
		})
		expect(recovered.swapCalls).toBe(1)
		expect(recovered.inputStates.states.every((value) => value === 'SPENT')).toBe(true)
		expect(recovered.inputStates.exactInputMatch).toBe(true)
		expect(recovered.receiptAmount).toBe(1000)
		expect(recovered.ownedProofs.reduce((sum, proof) => sum + proof.amount, 0)).toBe(1000)
		expect(recovered.ownedProofs.every((proof) => hasValidDleq(proof as never, keyset as never, { require: true }))).toBe(true)
		expect(recovered.recipientStates.states.every((value) => value === 'UNSPENT')).toBe(true)
		expect(recovered.recipientStates.exactInputMatch).toBe(true)
		const completedLifecycle = await authorityStore.readLifecycle(claim.operationId)
		expect(completedLifecycle?.status).toBe('recipient_imported')

		const evidence = {
			schema: 'PlebeianFridayIntegratedFrostCometV1', completed_at: new Date().toISOString(),
			source: { commit: SOURCE_COMMIT, poc_binary_sha256: await fileSha256(POC_BINARY),
				participant_binary_sha256: await fileSha256(PARTICIPANT_BINARY),
				inspector_binary_sha256: await fileSha256(INSPECTOR_BINARY) },
			value_profile: 'fake-money-only', mint: { implementation: 'Nutshell 0.19.2', backend: 'FakeWallet', input_fee_ppk: 0 },
			consensus: { chain_id: chainId, validators: 4, unavailable_validator: 4,
				first_height: firstAdmission.commit.height, displacement_height: secondAdmission.commit.height,
				initial_commit_signatures: initialPanel.validators.map((validator: any) => validator.commit_signatures),
				post_fault_commit_signatures: faultPanel.validators.filter((validator: any) => validator.online)
					.map((validator: any) => validator.commit_signatures) },
			admission: { participant_processes: 4, unavailable_policy_pid: unavailableWorkerPid,
				selected_participants: firstAdmission.committeeAuthorization.participantIds,
				real_rust_frost: true, dkg_run_id: dkg.dkgRunId, public_package_sha256: dkg.publicKeyPackageSha256 },
			outbid_return: { displaced_bid_id: certificate.displacedBidId, replacement_bid_id: certificate.replacementBidId,
				amount: recovered.receiptAmount, sigall_participants: threshold.participantIds,
				finality_commits: certificate.commits.map((commit) => ({ height: commit.height, block_hash: commit.blockHash, app_hash: commit.appHash })),
				observed_state: { height: certificate.displacementState.stateHeight,
					app_hash: certificate.displacementState.stateAppHash,
					binding_height: certificate.displacementState.bindingCommit.height,
					binding_app_hash: certificate.displacementState.bindingCommit.appHash },
				terminal_participant_processes: 4, unavailable_terminal_policy_pid: unavailableTerminalPolicyPid,
				participant_policy_digest: policyPackageDigest, frost_transcript_hash: threshold.transcriptHash,
				sigall_operation_root: threshold.operationRoot, mint_swap_calls: recovered.swapCalls,
				dleq_inputs_verified: true,
				nut07_input_states: recovered.inputStates.states,
				nut07_exact_input_match: recovered.inputStates.exactInputMatch,
				nut07_input_set_digest: recovered.inputStates.proofSetDigest,
				nut09_restored_outputs: recovered.restoredCount,
				recipient_proof_count: recovered.ownedProofs.length, recipient_amount: recovered.ownedProofs.reduce((sum, proof) => sum + proof.amount, 0),
				recipient_nut07_states: recovered.recipientStates.states,
				recipient_exact_input_match: recovered.recipientStates.exactInputMatch,
				recipient_proof_set_digest: recovered.recipientStates.proofSetDigest,
				durable_lifecycle: completedLifecycle?.status },
			transport: { admission_policy: 'separate local processes over stdio', terminal_policy: 'separate local signer processes over stdio', consensus: 'four loopback CometBFT processes', fips: false },
			limitations: ['not FIPS transport', 'not production custody', 'one local operator', 'no real-value endpoint'],
			passed: true,
		}
		const file = await open(EVIDENCE, 'wx', 0o600)
		try { await file.writeFile(`${JSON.stringify(evidence, null, 2)}\n`) } finally { await file.close() }
	} finally {
		for (const transport of terminalTransports) transport.close()
		await Promise.allSettled(terminalTransports.map((transport) => transport.waitClosed()))
		for (const worker of workers) await worker.close().catch(() => {})
		for (const database of databases.reverse()) database.close(false)
		await stopChild(localDemo)
	}
}, 420_000)
