import type {
	CocoAuctionAccountIdentity,
	CocoAuctionBidIntent,
	CocoAuctionBidProjection,
	CocoAuctionRefundInput,
	CocoAuctionWinnerReceiveInput,
	CocoAuctionWinnerReleaseInput,
} from './types'

/**
 * Publication-only material. It is intentionally confined to the sealed
 * engine/publisher callback and must never be returned by PlebeianWalletHost,
 * stored in Market command records, logged, or placed in UI state.
 */
export interface SealedCocoBidPublicationMaterial {
	operationId: string
	mintUrl: string
	unit: 'sat'
	grossAmount: number
	amount: number
	locktime: number
	recipientPublicAuthority: string
	refundPublicAuthority: string
	conditionFingerprint: string
	commitmentFingerprint: string
	lockSecrets: readonly string[]
	proofYs: readonly string[]
}

/** @see SealedCocoBidPublicationMaterial */
export interface SealedCocoWinnerReleaseMaterial {
	operationId: string
	derivationPath: string
	recipientPublicAuthority: string
	encodedToken: string
	tokenFingerprint: string
}

export type CocoEngineBidProjection = Omit<CocoAuctionBidProjection, 'commandId' | 'account' | 'auction' | 'bidderPubkey' | 'sellerPubkey'>

export interface CocoEnginePort {
	ensureSellerAuctionAuthority(account: CocoAuctionAccountIdentity): Promise<{ publicP2pkAuthority: string }>
	prepareBid(input: CocoAuctionBidIntent & { operationId: string }): Promise<CocoEngineBidProjection>
	inspectBid(operationId: string): Promise<CocoEngineBidProjection | null>
	cancelPreparedBid(operationId: string): Promise<void>
	executeBid(operationId: string): Promise<CocoEngineBidProjection>
	withBidPublicationMaterial<T>(operationId: string, use: (material: SealedCocoBidPublicationMaterial) => Promise<T>): Promise<T>
	releaseWinner<T>(
		input: CocoAuctionWinnerReleaseInput,
		use: (material: SealedCocoWinnerReleaseMaterial) => Promise<T>,
	): Promise<{ operationId: string; result: T }>
	receiveWinner(input: CocoAuctionWinnerReceiveInput): Promise<{ operationId: string; state: 'finalized' }>
	refundLosingBid(input: CocoAuctionRefundInput): Promise<{ operationId: string; state: 'refunded' }>
}

export interface CocoBidPublicationAdapter {
	/** Build, sign, and durably cache one exact kind-1023 without broadcasting it. */
	prepare(material: SealedCocoBidPublicationMaterial, intent: CocoAuctionBidIntent): Promise<{ eventId: string }>
	/** Broadcast the exact cached event. Repeated calls must not build a new event. */
	publish(eventId: string): Promise<void>
}

export interface CocoWinnerReleasePublicationAdapter {
	/** Build, sign, and durably cache one exact kind-1025 without broadcasting it. */
	prepare(material: SealedCocoWinnerReleaseMaterial, input: CocoAuctionWinnerReleaseInput): Promise<{ eventId: string }>
	/** Broadcast the exact cached event. */
	publish(eventId: string): Promise<void>
}

export class CocoV2CoreUnavailableError extends Error {
	constructor() {
		super(
			'Coco v2 Auction engine is unavailable: Market currently resolves coco-cashu-core 1.0.0-rc11, which lacks durable prepare/execute/cancel operations and caller-supplied Send operation IDs.',
		)
		this.name = 'CocoV2CoreUnavailableError'
	}
}

/**
 * Fail-closed placeholder used until the reviewed Coco v2 operation candidate
 * (including caller-supplied Send IDs and P2PK refund recovery) is consumable
 * as one pinned package. It never delegates to NIP-60.
 */
export class UnavailableCocoV2EnginePort implements CocoEnginePort {
	private unavailable(): never {
		throw new CocoV2CoreUnavailableError()
	}

	async ensureSellerAuctionAuthority(): Promise<never> {
		return this.unavailable()
	}
	async prepareBid(): Promise<never> {
		return this.unavailable()
	}
	async inspectBid(): Promise<never> {
		return this.unavailable()
	}
	async cancelPreparedBid(): Promise<never> {
		return this.unavailable()
	}
	async executeBid(): Promise<never> {
		return this.unavailable()
	}
	async withBidPublicationMaterial<T>(): Promise<T> {
		return this.unavailable()
	}
	async releaseWinner<T>(): Promise<{ operationId: string; result: T }> {
		return this.unavailable()
	}
	async receiveWinner(): Promise<never> {
		return this.unavailable()
	}
	async refundLosingBid(): Promise<never> {
		return this.unavailable()
	}
}
