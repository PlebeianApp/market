import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { getEncodedToken } from '@cashu/coco-core'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	createDemoFridayBrowserCocoClient,
	demoFridayAdmissionStatusDigest,
	type DemoFridayFundingAdmissionStatusV1,
} from './demo-friday-browser-coco-client'
import { createDemoFridayBrowserPaymentOperation } from './demo-friday-browser-payment-state'
import { buildDemoSigAllSecret, demoDenominationKeyDigest, demoOutputsDigest, demoRecipientCapabilityDigest } from './demo-sigall-settlement'

const privateKey = (value: number) => hexToBytes(value.toString(16).padStart(64, '0'))
const actor = bytesToHex(schnorr.getPublicKey(privateKey(1)))
const leaderActor = bytesToHex(schnorr.getPublicKey(privateKey(2)))
const compressed = (value: number) => bytesToHex(secp256k1.getPublicKey(privateKey(value), true))
const mintUrl = 'https://172.105.64.142'
const keyset = { id: '00deadbeef', unit: 'sat' as const, keys: { '4': compressed(20), '8': compressed(21) } }
const deployment = {
	schema: 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_V1' as const,
	environmentId: 'friday-live', authNetworkId: 'friday-network', chainId: 'friday-chain', genesisSha256: '9'.repeat(64), canonicalMintUrl: mintUrl,
	mintSnapshot: { mintUrl, mintPublicKey: compressed(22), serverVersion: 'Nutshell/0.19.2',
		activeSatKeysetId: keyset.id, denominationKeyDigest: demoDenominationKeyDigest(keyset.keys),
		denominationAmounts: [4, 8], inputFeePpk: 0, nuts: [4, 7, 9, 10, 11, 12] },
	keyset, committeePublicKey: compressed(23), committeeKeysetId: 'committee-1',
	committeeKeysetVersion: 'version-1', dkgRunId: 'dkg-1', publicKeyPackageSha256: 'a'.repeat(64),
	signerRosterDigest: 'b'.repeat(64), participants: [
		{ identifier: 1 as const, verifyingShare: compressed(41) },
		{ identifier: 2 as const, verifyingShare: compressed(42) },
		{ identifier: 3 as const, verifyingShare: compressed(43) },
		{ identifier: 4 as const, verifyingShare: compressed(44) },
	] as [{ identifier: 1; verifyingShare: string }, { identifier: 2; verifyingShare: string },
		{ identifier: 3; verifyingShare: string }, { identifier: 4; verifyingShare: string }],
}

function winnerRequest() {
	const outputs = [{ amount: 4, id: keyset.id, B_: compressed(30) }, { amount: 8, id: keyset.id, B_: compressed(31) }]
	const base = { schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const, network: deployment.authNetworkId,
		chainId: deployment.chainId, auctionId: 'auction-1', operationId: 'operation-1', role: 'winner_settlement' as const,
		mintUrl, unit: 'sat', recipientPublicKey: compressed(3), outputsDigest: demoOutputsDigest(outputs),
		signature: '0'.repeat(128) }
	return { capability: { ...base, signature: bytesToHex(schnorr.sign(
		hexToBytes(demoRecipientCapabilityDigest(base)), privateKey(3),
	)) }, outputs }
}

function preWalletClient(auctionValue: unknown, opened: { value: boolean }) {
	let walletLockHeld = false
	return createDemoFridayBrowserCocoClient({
		deployment: { async readExact() { return deployment } },
		auction: { async readExact() { return structuredClone(auctionValue) as never } },
		walletFactory: { async openExact() {
			if (!walletLockHeld) throw new Error('wallet-opened-without-lock')
			opened.value = true; throw new Error('wallet-opened')
		} },
		state: { async runWalletExclusive<T>(_identity: unknown, run: () => Promise<T>) {
			walletLockHeld = true
			try { return await run() } finally { walletLockHeld = false }
		} } as never,
		nostrSigner: { async getPublicKey() { return actor }, async signEvent() { throw new Error('unused') } },
		builder: {} as never, admission: {} as never, terminal: {} as never,
	})
}

const fundingRequest = { auctionId: 'auction-1', fundingOperationId: 'operation-1', bidAmount: 12,
	fullPoolAmount: 12, reservedPoolAmount: 12, replacesBidId: 'c'.repeat(64), locktime: 10_000 }

function operationFixture() {
	let next = 40
	return createDemoFridayBrowserPaymentOperation({
		actor, environmentId: deployment.environmentId, authNetworkId: deployment.authNetworkId,
		chainId: deployment.chainId, auctionId: fundingRequest.auctionId, fundingOperationId: fundingRequest.fundingOperationId,
		canonicalMintUrl: mintUrl, mintPublicKey: deployment.mintSnapshot.mintPublicKey,
		mintServerVersion: deployment.mintSnapshot.serverVersion, bidAmount: 12, fullPoolAmount: 12,
		reservedPoolAmount: 12, replacesBidId: fundingRequest.replacesBidId, priorLeaderActor: leaderActor,
		winnerRecipientPublicKey: compressed(3), winnerRecipientCapabilityDigest: demoRecipientCapabilityDigest(winnerRequest().capability),
		winnerOutputsDigest: demoOutputsDigest(winnerRequest().outputs), keysetId: keyset.id,
		denominationKeyDigest: deployment.mintSnapshot.denominationKeyDigest, denominationAmounts: [4, 8],
		mintNuts: [4, 7, 9, 10, 11, 12], inputFeePpk: 0, committeePublicKey: deployment.committeePublicKey,
		committeeKeysetId: deployment.committeeKeysetId, committeeKeysetVersion: deployment.committeeKeysetVersion,
		dkgRunId: deployment.dkgRunId, publicKeyPackageSha256: deployment.publicKeyPackageSha256,
		signerRosterDigest: deployment.signerRosterDigest, locktime: fundingRequest.locktime,
	}, (bytes) => { bytes.fill(0); bytes[31] = next++; return bytes })
}

describe('Friday browser Coco client composition gates', () => {
	test('skips an indexed seller plan that has no bidder refund operation', async () => {
		let terminalReads = 0
		const client = createDemoFridayBrowserCocoClient({ deployment: {} as never, auction: {} as never,
			walletFactory: { async openExact() { throw new Error('seller plan must not open bidder Coco') } },
			state: { async runWalletExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async runOperationExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async loadOperation() { return null } } as never,
			nostrSigner: {} as never, builder: {} as never, admission: {} as never,
			terminal: { async readNoticeExact() { terminalReads += 1; throw new Error('must not read terminal notice') },
				async acknowledgeExact() { throw new Error('must not acknowledge') } },
		})
		await expect(client.importRefundExact({ actor, environmentId: deployment.environmentId,
			fundingOperationId: 'seller-plan-operation' })).resolves.toBeNull()
		expect(terminalReads).toBe(0)
	})

	test('rejects an impossible reservation before opening Coco', async () => {
		let touched = false
		const client = createDemoFridayBrowserCocoClient({
			deployment: { async readExact() { touched = true; throw new Error('must not reach deployment') } },
			auction: {} as never,
			walletFactory: {} as never,
			state: {} as never,
			nostrSigner: {} as never,
			builder: {} as never,
			admission: {} as never,
			terminal: {} as never,
		})
		await expect(client.prepareAndFinalize({
			auctionId: 'auction-1', fundingOperationId: 'raise-1', bidAmount: 5_000,
			fullPoolAmount: 4_000, reservedPoolAmount: 4_001, replacesBidId: 'a'.repeat(64), locktime: 10_000,
		})).rejects.toThrow(/funding request is invalid/)
		expect(touched).toBe(false)
	})

	test('requires advertised NUT-12 before opening Coco or reserving browser proofs', async () => {
		let opened = false
		const withoutDleq = structuredClone(deployment)
		withoutDleq.mintSnapshot.nuts = withoutDleq.mintSnapshot.nuts.filter((nut) => nut !== 12)
		const client = createDemoFridayBrowserCocoClient({
			deployment: { async readExact() { return withoutDleq } }, auction: {} as never,
			walletFactory: { async openExact() { opened = true; throw new Error('must not open') } },
			state: { async runWalletExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() } } as never,
			nostrSigner: { async getPublicKey() { return actor } } as never,
			builder: {} as never, admission: {} as never, terminal: {} as never,
		})
		await expect(client.prepareAndFinalize(fundingRequest)).rejects.toThrow(/cryptographic snapshot/)
		expect(opened).toBe(false)
	})

	test('persists the app marker only after Coco durably prepares, then resumes without creating a replacement', async () => {
		let operation: ReturnType<typeof operationFixture> | null = null
		let binds = 0, resumes = 0, disposals = 0, builderCalls = 0
		const client = createDemoFridayBrowserCocoClient({
			deployment: { async readExact() { return deployment } },
			auction: { async readExact() { return { schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1',
				auctionId: 'auction-1', leaderBidId: fundingRequest.replacesBidId, leaderActor,
				leaderBidAmount: 10, sellerPaymentPublicKey: compressed(3), winnerRequest: winnerRequest() } } },
			walletFactory: { async openExact() { return {
				actor, mintUrl, seedLocation: 'indexeddb' as const,
				async inspect() { return structuredClone(deployment.mintSnapshot) },
				async prepareThresholdFundingOperation() {
					binds += 1
					return { operationId: fundingRequest.fundingOperationId, state: 'prepared' as const }
				},
				async prepareThresholdFunding() {
					resumes += 1
					throw new Error('strict NUT-12/DLEQ verification refused the mint proofs')
				},
				async dispose() { disposals += 1 },
			} as never } },
			state: {
				async runWalletExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async runOperationExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async loadOperation() { return operation === null ? null : structuredClone(operation) },
				async saveOperation(next: ReturnType<typeof operationFixture>, expected: number | null) {
					if (expected === null) expect(operation).toBeNull()
					else expect(operation?.revision).toBe(expected)
					operation = structuredClone(next)
				},
			} as never,
			nostrSigner: { async getPublicKey() { return actor } } as never,
			builder: { async buildAbortCapsuleExact() { builderCalls += 1; throw new Error('must not build') } } as never,
			admission: {} as never, terminal: {} as never,
		})
		await expect(client.prepareAndFinalize(fundingRequest)).rejects.toThrow(/NUT-12\/DLEQ/)
		expect(operation).toMatchObject({ phase: 'coco_send_pending', fundingOperationId: fundingRequest.fundingOperationId,
			revision: 1 })
		await expect(client.prepareAndFinalize(fundingRequest)).rejects.toThrow(/NUT-12\/DLEQ/)
		expect(operation).toMatchObject({ phase: 'coco_send_pending', fundingOperationId: fundingRequest.fundingOperationId,
			revision: 1 })
		expect({ binds, resumes, disposals, builderCalls }).toEqual({ binds: 1, resumes: 2, disposals: 2, builderCalls: 0 })
	})

	test('fails closed instead of creating a Coco send when the app marker exists but Coco lost the operation', async () => {
		let operation = operationFixture()
		operation.phase = 'coco_send_pending'
		operation.revision = 1
		let binds = 0, resumes = 0
		const client = createDemoFridayBrowserCocoClient({
			deployment: { async readExact() { return deployment } },
			auction: { async readExact() { return { schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1',
				auctionId: 'auction-1', leaderBidId: fundingRequest.replacesBidId, leaderActor,
				leaderBidAmount: 10, sellerPaymentPublicKey: compressed(3), winnerRequest: winnerRequest() } } },
			walletFactory: { async openExact() { return {
				actor, mintUrl, seedLocation: 'indexeddb' as const,
				async inspect() { return structuredClone(deployment.mintSnapshot) },
				async prepareThresholdFundingOperation() { binds += 1; throw new Error('must not create') },
				async prepareThresholdFunding() { resumes += 1; throw new Error('refused-threshold-operation-absent') },
				async dispose() {},
			} as never } },
			state: { async runWalletExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async runOperationExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async loadOperation() { return structuredClone(operation) },
				async saveOperation() { throw new Error('must not rewrite marker') } } as never,
			nostrSigner: { async getPublicKey() { return actor } } as never,
			builder: {} as never, admission: {} as never, terminal: {} as never,
		})
		await expect(client.prepareAndFinalize(fundingRequest)).rejects.toThrow(/operation-absent/)
		expect({ binds, resumes, phase: operation.phase }).toEqual({ binds: 0, resumes: 1, phase: 'coco_send_pending' })
	})

	test('retains Coco and app recovery identity when post-swap DLEQ validation refuses capsule construction', async () => {
		let operation: ReturnType<typeof operationFixture> | null = null
		const recipientRows = new Map<string, unknown>()
		let binds = 0, resumes = 0, capsuleAttempts = 0
		const heldToken = getEncodedToken({ mint: mintUrl, unit: 'sat', proofs: [{
			amount: 12, id: keyset.id,
			secret: buildDemoSigAllSecret({ nonce: '7'.repeat(64), bidderPublicKey: compressed(40),
				committeePublicKey: deployment.committeePublicKey, refundPublicKey: compressed(41),
				locktime: fundingRequest.locktime }),
			C: compressed(42),
		}] } as never)
		const client = createDemoFridayBrowserCocoClient({
			deployment: { async readExact() { return deployment } },
			auction: { async readExact() { return { schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1',
				auctionId: 'auction-1', leaderBidId: fundingRequest.replacesBidId, leaderActor,
				leaderBidAmount: 10, sellerPaymentPublicKey: compressed(3), winnerRequest: winnerRequest() } } },
			walletFactory: { async openExact() { return {
				actor, mintUrl, seedLocation: 'indexeddb' as const,
				async inspect() { return structuredClone(deployment.mintSnapshot) },
				async prepareThresholdFundingOperation() { binds += 1; return {
					operationId: fundingRequest.fundingOperationId, state: 'prepared' as const,
				} },
				async prepareThresholdFunding() { resumes += 1; return { operationId: fundingRequest.fundingOperationId,
					token: heldToken, state: 'pending' as const, amount: 12, keysetId: keyset.id } },
				async dispose() {},
			} as never } },
			state: {
				async runWalletExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async runOperationExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async runExclusive<T>(_scope: string, run: () => Promise<T>) { return run() },
				async load(scope: string) { return structuredClone(recipientRows.get(scope) ?? null) },
				async savePrepared(scope: string, record: unknown) { recipientRows.set(scope, structuredClone(record)) },
				async loadOperation() { return operation === null ? null : structuredClone(operation) },
				async saveOperation(next: ReturnType<typeof operationFixture>, expected: number | null) {
					if (expected === null) expect(operation).toBeNull()
					else expect(operation?.revision).toBe(expected)
					operation = structuredClone(next)
				},
			} as never,
			nostrSigner: { async getPublicKey() { return actor } } as never,
			builder: { async buildAbortCapsuleExact() {
				capsuleAttempts += 1
				throw new Error('DLEQ is required for every locked proof')
			} } as never,
			admission: {} as never, terminal: {} as never,
		})
		await expect(client.prepareAndFinalize(fundingRequest)).rejects.toThrow(/DLEQ is required/)
		expect(operation).toMatchObject({ phase: 'coco_send_pending', revision: 1,
			fundingOperationId: fundingRequest.fundingOperationId })
		await expect(client.prepareAndFinalize(fundingRequest)).rejects.toThrow(/DLEQ is required/)
		expect(operation).toMatchObject({ phase: 'coco_send_pending', revision: 1 })
		expect({ binds, resumes, capsuleAttempts }).toEqual({ binds: 1, resumes: 2, capsuleAttempts: 2 })
	})

	test('allows an exact competitor replacement through the pre-lock checks', async () => {
		const opened = { value: false }
		const client = preWalletClient({ schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1',
			auctionId: 'auction-1', leaderBidId: fundingRequest.replacesBidId, leaderActor,
			leaderBidAmount: 10, sellerPaymentPublicKey: compressed(3), winnerRequest: winnerRequest() }, opened)
		await expect(client.prepareAndFinalize(fundingRequest)).rejects.toThrow('wallet-opened')
		expect(opened.value).toBe(true)
	})

	test('rejects stale replacement, same-actor raise, and changed seller outputs before opening Coco', async () => {
		const cases = [
			{ schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1', auctionId: 'auction-1',
				leaderBidId: 'd'.repeat(64), leaderActor, leaderBidAmount: 10,
				sellerPaymentPublicKey: compressed(3), winnerRequest: winnerRequest() },
			{ schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1', auctionId: 'auction-1',
				leaderBidId: fundingRequest.replacesBidId, leaderActor: actor, leaderBidAmount: 10,
				sellerPaymentPublicKey: compressed(3), winnerRequest: winnerRequest() },
			(() => { const exact = winnerRequest(); exact.outputs[0]!.B_ = compressed(32); return {
				schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1', auctionId: 'auction-1',
				leaderBidId: fundingRequest.replacesBidId, leaderActor, leaderBidAmount: 10,
				sellerPaymentPublicKey: compressed(3), winnerRequest: exact,
			} })(),
		]
		for (const value of cases) {
			const opened = { value: false }
			await expect(preWalletClient(value, opened).prepareAndFinalize(fundingRequest)).rejects.toThrow()
			expect(opened.value).toBe(false)
		}
	})

	test('replays one persisted canonical ack without reopening Coco or exposing local replay state', async () => {
		const operation = operationFixture()
		operation.refundDelivery = { intent: { schema: 'COCO_DEMO_RECIPIENT_INTENT_V1', network: operation.authNetworkId,
			chainId: operation.chainId, auctionId: operation.auctionId, operationId: operation.fundingOperationId,
			role: 'refund', mintUrl, unit: 'sat', recipientPublicKey: operation.refundPublicKey, amounts: [4, 8] }, keyset }
		operation.pendingTerminalAck = { schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1', actor,
			fundingOperationId: operation.fundingOperationId, noticeDigest: 'd'.repeat(64), importReceipt: {
				schema: 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1', operationId: operation.fundingOperationId,
				role: 'refund', recipientPublicKey: operation.refundPublicKey, amount: 12, proofCount: 2, imported: true,
			}, recipientAckSignature: 'e'.repeat(128) }
		const sent: string[] = []
		const client = createDemoFridayBrowserCocoClient({ deployment: {} as never, auction: {} as never,
			walletFactory: { async openExact() { throw new Error('Coco must not reopen for ack replay') } },
			state: { async runWalletExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async runOperationExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async loadOperation() { return structuredClone(operation) } } as never,
			nostrSigner: {} as never, builder: {} as never, admission: {} as never,
			terminal: { async readNoticeExact() { throw new Error('must replay before reread') },
				async acknowledgeExact(value) { sent.push(JSON.stringify(value)) } },
		})
		const identity = { actor, environmentId: operation.environmentId, fundingOperationId: operation.fundingOperationId }
		expect(await client.importRefundExact(identity)).toMatchObject({ imported: true, alreadyImported: true })
		expect(await client.importRefundExact(identity)).toMatchObject({ imported: true, alreadyImported: true })
		expect(sent).toHaveLength(2)
		expect(sent[0]).toBe(sent[1])
		expect(sent[0]).not.toContain('alreadyImported')
		expect(sent[0]).not.toContain(operation.paymentSecret)
		expect(sent[0]).not.toContain(operation.refundSecret)
	})

	test('accepts only the exact canonical finalized status on recovery', async () => {
		const operation = operationFixture()
		const unsigned = { pubkey: actor, created_at: 1_000, kind: 28_641, tags: [] as string[][], content: '{}' }
		const eventId = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
			0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
		]))))
		const signedBid = { ...unsigned, id: eventId, sig: bytesToHex(schnorr.sign(hexToBytes(eventId), privateKey(1))) }
		operation.phase = 'finalized'
		operation.fundingAuthorizationEventId = 'e'.repeat(64)
		operation.preparedBid = { preparationId: 'prepare-1', fundingAuthorizationEventId: operation.fundingAuthorizationEventId,
			receiptDigest: 'f'.repeat(64), unsignedBid: unsigned }
		operation.signedBid = signedBid
		const status: DemoFridayFundingAdmissionStatusV1 = { status: 'admitted', preparationId: 'prepare-1',
			fundingOperationId: operation.fundingOperationId, fundingAuthorizationEventId: operation.fundingAuthorizationEventId,
			bidAmount: 12, reservedPoolAmount: 12, canonicalMintUrl: mintUrl, signedBidEventId: eventId,
			receiptDigest: operation.preparedBid.receiptDigest, transactionHash: '9'.repeat(64), committedHeight: 42 }
		operation.finalizedStatusDigest = demoFridayAdmissionStatusDigest(status)
		let returned = structuredClone(status)
		const client = createDemoFridayBrowserCocoClient({ deployment: {} as never, auction: {} as never,
			walletFactory: {} as never, nostrSigner: {} as never, builder: {} as never, terminal: {} as never,
			state: { async runWalletExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async runOperationExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async loadOperation() { return structuredClone(operation) } } as never,
			admission: { async readExact() { return structuredClone(returned) } } as never,
		})
		const identity = { actor, environmentId: operation.environmentId, fundingOperationId: operation.fundingOperationId }
		await expect(client.recoverExact(identity)).resolves.toEqual(status)
		returned = { ...status, transactionHash: '8'.repeat(64) }
		await expect(client.recoverExact(identity)).rejects.toThrow(/canonical stored digest/)
	})

	test('recovers a lost confirmation response with the exact persisted signed bid and never re-signs', async () => {
		let operation = operationFixture()
		const unsigned = { pubkey: actor, created_at: 1_000, kind: 28_641, tags: [] as string[][], content: '{}' }
		const eventId = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
			0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
		]))))
		const signedBid = { ...unsigned, id: eventId, sig: bytesToHex(schnorr.sign(hexToBytes(eventId), privateKey(1))) }
		operation.phase = 'server_prepared'
		operation.fundingAuthorizationEventId = 'e'.repeat(64)
		operation.preparedBid = { preparationId: 'prepare-1', fundingAuthorizationEventId: operation.fundingAuthorizationEventId,
			receiptDigest: 'f'.repeat(64), unsignedBid: unsigned }
		operation.signedBid = signedBid
		const base = { preparationId: 'prepare-1', fundingOperationId: operation.fundingOperationId,
			fundingAuthorizationEventId: operation.fundingAuthorizationEventId, bidAmount: 12,
			reservedPoolAmount: 12, canonicalMintUrl: mintUrl }
		const admitted: DemoFridayFundingAdmissionStatusV1 = { ...base, status: 'admitted',
			signedBidEventId: eventId, receiptDigest: operation.preparedBid.receiptDigest,
			transactionHash: '9'.repeat(64), committedHeight: 42 }
		const resumed: unknown[] = []
		const client = createDemoFridayBrowserCocoClient({ deployment: {} as never, auction: {} as never,
			walletFactory: {} as never, nostrSigner: { async signEvent() { throw new Error('must not re-sign') } } as never,
			builder: {} as never, terminal: {} as never,
			state: { async runWalletExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async runOperationExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
				async loadOperation() { return structuredClone(operation) },
				async saveOperation(next: typeof operation, expected: number | null) {
					expect(expected).toBe(operation.revision); operation = structuredClone(next)
				} } as never,
			admission: { async readExact() { return { ...base, status: 'unknown' as const } },
				async finalizeExact(request: unknown) { resumed.push(structuredClone(request)); return structuredClone(admitted) } } as never,
		})
		const identity = { actor, environmentId: operation.environmentId, fundingOperationId: operation.fundingOperationId }
		await expect(client.recoverExact(identity)).resolves.toEqual(admitted)
		expect(resumed).toEqual([{ preparationId: 'prepare-1', fundingOperationId: operation.fundingOperationId,
			fundingAuthorizationEventId: operation.fundingAuthorizationEventId, signedBid }])
		expect(String(operation.phase)).toBe('finalized')
		expect(operation.finalizedStatusDigest).toBe(demoFridayAdmissionStatusDigest(admitted))
	})
})

for(const phase of ['bid','refund'] as const)test(`P2 bidder ${phase} disposal failure reaches production common-lease fence`,async()=>{
 const {createDemoFridayBrowserPaymentState}=await import('./demo-friday-browser-payment-state')
 let tail=Promise.resolve(),opens=0,disposals=0
 const locks={request<T>(_name:string,_options:unknown,run:()=>Promise<T>):Promise<T>{const previous=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r});return previous.then(run).finally(release)}}
 const tab=()=>createDemoFridayBrowserPaymentState({indexedDB:{} as IDBFactory,locks})
 const trusted={...deployment,environmentId:`p2-bidder-${phase}`},operation=operationFixture()
 operation.environmentId=trusted.environmentId;operation.refundDelivery={intent:{} as never,keyset:{} as never}
 const identity={actor,environmentId:trusted.environmentId,fundingOperationId:fundingRequest.fundingOperationId}
 const client=createDemoFridayBrowserCocoClient({deployment:{async readExact(){return trusted}},auction:{async readExact(){return {schema:'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1',auctionId:'auction-1',leaderBidId:fundingRequest.replacesBidId,leaderActor,leaderBidAmount:10,sellerPaymentPublicKey:compressed(3),winnerRequest:winnerRequest()}}},
  walletFactory:{async openExact(){opens++;return {actor,mintUrl,async inspect(){throw new Error('initial wallet observation refused')},async dispose(){disposals++;throw new Error('cleanup unconfirmed')}} as never}},
  state:{runWalletExclusive:tab().runWalletExclusive,async runOperationExclusive(_i:unknown,run:()=>Promise<unknown>){return run()},async loadOperation(){return operation}} as never,
  nostrSigner:{async getPublicKey(){return actor}} as never,builder:{} as never,admission:{} as never,
  terminal:{async readNoticeExact(){return {schema:'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1',actor,network:operation.authNetworkId,chainId:operation.chainId,auctionId:operation.auctionId,operationId:operation.fundingOperationId,role:'refund',mintUrl,amount:12,recipientCapabilityDigest:'0'.repeat(64),signatures:[{amount:4,id:keyset.id,C_:compressed(30)},{amount:8,id:keyset.id,C_:compressed(31)}]}},async acknowledgeExact(){throw new Error('no ack allowed')}}})
 await expect(phase==='bid'?client.prepareAndFinalize(fundingRequest):client.importRefundExact(identity)).rejects.toThrow(/DRAIN_UNCONFIRMED/)
 expect(opens).toBe(1);expect(disposals).toBe(1);let next=false
 await expect(tab().runWalletExclusive(identity,async()=>{next=true})).rejects.toThrow(/DRAIN_UNCONFIRMED/);expect(next).toBe(false)
})
