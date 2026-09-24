import { getEncodedToken, type Manager, type ReceiveOperation, type SendOperation } from '@cashu/coco-core'
import { getTokenMetadata } from '@cashu/cashu-ts'
import { getSecretsFromSerializedOutputData } from '@cashu/coco-core/adapter'
import { HDKey } from '@scure/bip32'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { auctionP2pkPubkeysMatch, deriveAuctionChildP2pkPubkeyFromXpub, normalizeAuctionDerivationPath } from '@/lib/auctionP2pk'
import { hashToCurveHexFromString } from '@/lib/cashu/hashToCurve'
import { type CocoAccountRuntime, CocoRuntimeRegistry } from '@/lib/coco/runtime'
import { runBrowserFreshAuctionsdevCocoMutation } from '@/lib/coco/migration/runtimeGate'
import { fingerprintCocoAuctionValue } from './canonical'
import type {
	CocoEngineBidProjection,
	CocoEnginePort,
	SealedCocoBidPublicationMaterial,
	SealedCocoWinnerReleaseMaterial,
} from './enginePort'
import type {
	CocoAuctionAccountIdentity,
	CocoAuctionBidIntent,
	CocoAuctionRefundInput,
	CocoAuctionWinnerReceiveInput,
	CocoAuctionWinnerReleaseInput,
} from './types'

const AUCTION_ACCOUNT_PATH = "m/30408'/0'/0'"

const deriveBytes = (seed: Uint8Array, domain: string, operationId?: string): Uint8Array =>
	hmac(sha256, seed, new TextEncoder().encode(operationId ? `${domain}:${operationId}` : domain))

const deriveAuctionAccount = (seed: Uint8Array): HDKey => HDKey.fromMasterSeed(seed).derive(AUCTION_ACCOUNT_PATH)

const deriveOperationPath = (seed: Uint8Array, operationId: string): string => {
	const entropy = deriveBytes(seed, 'plebeian.market:coco-v2:auction-path:v1', operationId)
	const indices: number[] = []
	for (let offset = 0; offset < 20; offset += 4) {
		indices.push(((entropy[offset] & 0x7f) << 24) | (entropy[offset + 1] << 16) | (entropy[offset + 2] << 8) | entropy[offset + 3])
	}
	return `m/${indices.join('/')}`
}

const deriveRefundSecret = (seed: Uint8Array, operationId: string): Uint8Array => {
	const root = HDKey.fromMasterSeed(deriveBytes(seed, 'plebeian.market:coco-v2:auction-refund:v1', operationId))
	const secret = root.derive('m/0').privateKey
	if (!secret) throw new Error('Failed to derive Coco Auction refund authority')
	return secret
}

const ensureTrustedMint = async (manager: Manager, mintUrl: string): Promise<void> => {
	if (await manager.mint.isTrustedMint(mintUrl)) return
	const known = (await manager.mint.getAllMints()).some((mint) => mint.mintUrl === mintUrl)
	if (known) await manager.mint.trustMint(mintUrl)
	else await manager.mint.addMint(mintUrl, { trusted: true })
}

const requirePreparedData = (operation: SendOperation) => {
	if (operation.state === 'init') throw new Error('Coco Send operation has not been prepared')
	return operation
}

const commitmentFingerprint = (operation: SendOperation): string => {
	const prepared = requirePreparedData(operation)
	if (!prepared.outputData) throw new Error('Coco P2PK Send has no durable output plan')
	const secrets = [...getSecretsFromSerializedOutputData(prepared.outputData).sendSecrets].sort()
	if (!secrets.length) throw new Error('Coco P2PK Send has no durable locked outputs')
	return fingerprintCocoAuctionValue({ operationId: operation.id, lockSecrets: secrets })
}

const conditionFingerprint = (input: CocoAuctionBidIntent, recipient: string, refund: string): string =>
	fingerprintCocoAuctionValue({
		operationId: input.commandId,
		mintUrl: input.mintUrl,
		unit: input.unit,
		amount: input.amount,
		locktime: input.locktime,
		recipient,
		refund,
	})

const getOperationRecipient = (operation: SendOperation): string => {
	if (operation.method !== 'p2pk' || !('options' in operation.methodData) || !operation.methodData.options) {
		throw new Error('Coco Auction Send is not a P2PK operation')
	}
	const options = operation.methodData.options
	const recipient = 'data' in options ? options.data : Array.isArray(options.pubkey) ? options.pubkey[0] : options.pubkey
	if (!recipient) throw new Error('Coco Auction Send has no recipient authority')
	return recipient
}

const requireOperationBinding = (operation: SendOperation, input: CocoAuctionBidIntent, recipient: string, refund: string): void => {
	if (operation.id !== input.commandId) throw new Error('Coco Send operation identity mismatch')
	if (operation.mintUrl !== input.mintUrl || operation.unit !== input.unit || operation.amount.toNumber() !== input.amount) {
		throw new Error('Coco Send operation monetary binding mismatch')
	}
	if (operation.method !== 'p2pk' || !('options' in operation.methodData) || !operation.methodData.options) {
		throw new Error('Coco Auction Send is not a P2PK operation')
	}
	const options = operation.methodData.options
	const optionRecipient = getOperationRecipient(operation)
	if (optionRecipient?.toLowerCase() !== recipient.toLowerCase()) throw new Error('Coco recipient authority mismatch')
	if (options.locktime !== input.locktime) throw new Error('Coco locktime mismatch')
	if (!options.refundKeys?.some((key) => key.toLowerCase() === refund.toLowerCase())) {
		throw new Error('Coco refund authority mismatch')
	}
}

const requireReceiveBinding = (operation: ReceiveOperation, input: CocoAuctionWinnerReceiveInput): void => {
	if (operation.id !== input.commandId) throw new Error('Coco Receive operation identity mismatch')
	if (operation.mintUrl !== input.mintUrl || operation.unit !== input.unit || operation.amount.toNumber() !== input.amount) {
		throw new Error('Coco Receive operation monetary binding mismatch')
	}
}

export class CocoV2AuctionEnginePort implements CocoEnginePort {
	constructor(private readonly runtimes: CocoRuntimeRegistry) {}

	async ensureSellerAuctionAuthority(account: CocoAuctionAccountIdentity): Promise<{ publicP2pkAuthority: string }> {
		const runtime = await this.runtimes.get(account)
		const xpub = deriveAuctionAccount(await runtime.loadSeed()).publicExtendedKey
		if (!xpub) throw new Error('Failed to derive seller Auction public authority')
		return { publicP2pkAuthority: xpub }
	}

	async prepareBid(input: CocoAuctionBidIntent & { operationId: string }): Promise<CocoEngineBidProjection> {
		return this.authorize(input.account, async () => {
			const runtime = await this.runtimes.get(input.account)
			await ensureTrustedMint(runtime.manager, input.mintUrl)
			const { recipient, refund } = await this.resolveAuthorities(runtime, input)
			const operation = await runtime.manager.ops.send.prepare({
				operationId: input.operationId,
				mintUrl: input.mintUrl,
				amount: input.amount,
				unit: input.unit,
				target: {
					type: 'p2pk',
					options: {
						pubkey: recipient,
						locktime: input.locktime,
						refundKeys: [refund],
						requiredRefundSignatures: 1,
					},
				},
			})
			return this.project(input, operation, recipient, refund, 'prepared')
		})
	}

	async inspectBid(input: CocoAuctionBidIntent & { operationId: string }): Promise<CocoEngineBidProjection | null> {
		const runtime = await this.runtimes.get(input.account)
		const operation = await runtime.manager.ops.send.get(input.operationId)
		if (!operation) return null
		const { recipient, refund } = await this.resolveAuthorities(runtime, input)
		return this.project(input, operation, recipient, refund, operation.state === 'prepared' ? 'prepared' : 'executed')
	}

	async cancelPreparedBid(operationId: string, account: CocoAuctionAccountIdentity): Promise<void> {
		await this.authorize(account, async () => {
			const runtime = await this.runtimes.get(account)
			const operation = await runtime.manager.ops.send.get(operationId)
			if (!operation || operation.state === 'rolled_back') return
			if (operation.state !== 'prepared') throw new Error(`Coco Send cannot be cancelled from ${operation.state}`)
			await runtime.manager.ops.send.cancel(operationId)
		})
	}

	async executeBid(input: CocoAuctionBidIntent & { operationId: string }): Promise<CocoEngineBidProjection> {
		return this.authorize(input.account, async () => {
			const runtime = await this.runtimes.get(input.account)
			const { recipient, refund } = await this.resolveAuthorities(runtime, input)
			const current = await runtime.manager.ops.send.get(input.operationId)
			if (!current) throw new Error('Coco Send operation does not exist')
			requireOperationBinding(current, input, recipient, refund)
			const operation = current.state === 'prepared' ? (await runtime.manager.ops.send.execute(input.operationId)).operation : current
			if (operation.state !== 'pending' && operation.state !== 'finalized') {
				throw new Error(`Coco Send did not reach a publishable state: ${operation.state}`)
			}
			return this.project(input, operation, recipient, refund, 'executed')
		})
	}

	async withBidPublicationMaterial<T>(
		input: CocoAuctionBidIntent & { operationId: string },
		use: (material: SealedCocoBidPublicationMaterial) => Promise<T>,
	): Promise<T> {
		return this.authorize(input.account, async () => {
			const runtime = await this.runtimes.get(input.account)
			const { recipient, refund } = await this.resolveAuthorities(runtime, input)
			const operation = await runtime.manager.ops.send.get(input.operationId)
			if (!operation || (operation.state !== 'pending' && operation.state !== 'finalized') || !operation.token) {
				throw new Error('Coco Send has no executed publication material')
			}
			requireOperationBinding(operation, input, recipient, refund)
			const lockSecrets = operation.token.proofs.map((proof) => proof.secret)
			const proofYs = lockSecrets.map(hashToCurveHexFromString)
			const projection = this.project(input, operation, recipient, refund, 'executed')
			return use({
				operationId: operation.id,
				mintUrl: operation.mintUrl,
				unit: 'sat',
				grossAmount: input.grossAmount,
				amount: input.amount,
				locktime: input.locktime,
				recipientPublicAuthority: recipient,
				refundPublicAuthority: refund,
				conditionFingerprint: projection.conditionFingerprint,
				commitmentFingerprint: projection.commitmentFingerprint,
				lockSecrets,
				proofYs,
			})
		})
	}

	async releaseWinner<T>(
		input: CocoAuctionWinnerReleaseInput,
		use: (material: SealedCocoWinnerReleaseMaterial) => Promise<T>,
	): Promise<{ operationId: string; result: T }> {
		return this.authorize(input.account, async () => {
			const runtime = await this.runtimes.get(input.account)
			const operation = await runtime.manager.ops.send.get(input.sendOperationId)
			if (!operation || (operation.state !== 'pending' && operation.state !== 'finalized') || !operation.token) {
				throw new Error('Winning Coco Send has no releasable token')
			}
			const path = deriveOperationPath(await runtime.loadSeed(), operation.id)
			const result = await use({
				operationId: operation.id,
				derivationPath: path,
				recipientPublicAuthority: getOperationRecipient(operation),
				encodedToken: getEncodedToken(operation.token),
				tokenFingerprint: fingerprintCocoAuctionValue({
					operationId: operation.id,
					proofYs: operation.token.proofs.map((proof) => hashToCurveHexFromString(proof.secret)).sort(),
				}),
			})
			return { operationId: operation.id, result }
		})
	}

	async receiveWinner(input: CocoAuctionWinnerReceiveInput, encodedToken: string): Promise<{ operationId: string; state: 'finalized' }> {
		const runtime = await this.runtimes.get(input.account)
		await ensureTrustedMint(runtime.manager, input.mintUrl)

		const account = deriveAuctionAccount(await runtime.loadSeed())
		const xpriv = account.privateExtendedKey
		if (!xpriv) throw new Error('Seller Coco Auction account has no private authority')
		const child = HDKey.fromExtendedKey(xpriv).derive(normalizeAuctionDerivationPath(input.derivationPath))
		if (!child.privateKey || !child.publicKey) throw new Error('Failed to derive seller Coco Auction child authority')
		const childPublicAuthority = bytesToHex(child.publicKey)
		if (!auctionP2pkPubkeysMatch(childPublicAuthority, input.recipientPublicAuthority)) {
			throw new Error('Seller Coco child authority does not match the canonical winning bid')
		}
		if (!(await runtime.manager.keyring.getKeyPair(childPublicAuthority))) {
			const imported = await runtime.manager.keyring.addKeyPair(child.privateKey)
			if (!auctionP2pkPubkeysMatch(imported.publicKeyHex, childPublicAuthority)) {
				throw new Error('Coco imported a different seller child authority')
			}
		}

		const metadata = getTokenMetadata(encodedToken)
		const tokenFingerprint = fingerprintCocoAuctionValue({
			operationId: input.senderOperationId,
			proofYs: metadata.incompleteProofs.map((proof) => hashToCurveHexFromString(proof.secret)).sort(),
		})
		if (tokenFingerprint !== input.tokenFingerprint) throw new Error('Winner token fingerprint does not match the path release command')

		let operation = await runtime.manager.ops.receive.prepare({ operationId: input.commandId, token: encodedToken })
		requireReceiveBinding(operation, input)
		if (operation.state === 'executing') operation = await runtime.manager.ops.receive.refresh(operation.id)
		if (operation.state === 'prepared') operation = await runtime.manager.ops.receive.execute(operation.id)
		requireReceiveBinding(operation, input)
		if (operation.state !== 'finalized') throw new Error(`Coco Receive did not finalize: ${operation.state}`)
		return { operationId: operation.id, state: 'finalized' }
	}

	async refundLosingBid(input: CocoAuctionRefundInput): Promise<{ operationId: string; state: 'refunded' }> {
		return this.authorize(input.account, async () => {
			const runtime = await this.runtimes.get(input.account)
			const operation = await runtime.manager.ops.send.get(input.sendOperationId)
			if (!operation || operation.state === 'rolled_back') return { operationId: input.sendOperationId, state: 'refunded' }
			if (Math.floor(Date.now() / 1000) < input.locktime) throw new Error('Coco Auction refund timelock has not elapsed')
			const reclaimed = await runtime.manager.ops.send.reclaim(input.sendOperationId, { spendingPath: 'refund' })
			if (reclaimed.state !== 'rolled_back') throw new Error(`Coco refund did not finalize: ${reclaimed.state}`)
			return { operationId: reclaimed.id, state: 'refunded' }
		})
	}

	private authorize<T>(account: CocoAuctionAccountIdentity, mutation: () => Promise<T>): Promise<T> {
		return runBrowserFreshAuctionsdevCocoMutation(
			{ account: account.accountPubkey, environment: account.environmentId as 'auctionsdev' | 'test' },
			mutation,
		)
	}

	private async resolveAuthorities(
		runtime: CocoAccountRuntime,
		input: CocoAuctionBidIntent,
	): Promise<{ recipient: string; refund: string }> {
		const seed = await runtime.loadSeed()
		const recipient = deriveAuctionChildP2pkPubkeyFromXpub(input.sellerPublicAuthority, deriveOperationPath(seed, input.commandId))
		const refundSecret = deriveRefundSecret(seed, input.commandId)
		const refund = `02${bytesToHex(schnorr.getPublicKey(refundSecret))}`
		if (!(await runtime.manager.keyring.getKeyPair(refund))) {
			const imported = await runtime.manager.keyring.addKeyPair(refundSecret)
			if (imported.publicKeyHex.toLowerCase() !== refund.toLowerCase()) {
				throw new Error('Coco imported a different refund authority')
			}
		}
		return { recipient, refund }
	}

	private project(
		input: CocoAuctionBidIntent,
		operation: SendOperation,
		recipient: string,
		refund: string,
		status: 'prepared' | 'executed',
	): CocoEngineBidProjection {
		requireOperationBinding(operation, input, recipient, refund)
		const prepared = requirePreparedData(operation)
		return {
			operationId: operation.id,
			sellerPublicAuthority: input.sellerPublicAuthority,
			mintUrl: operation.mintUrl,
			unit: 'sat',
			grossAmount: input.grossAmount,
			amount: operation.amount.toNumber(),
			fee: prepared.fee.toNumber(),
			locktime: input.locktime,
			recipientPublicAuthority: recipient,
			refundPublicAuthority: refund,
			conditionFingerprint: conditionFingerprint(input, recipient, refund),
			commitmentFingerprint: commitmentFingerprint(operation),
			status,
		}
	}
}
