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
	inspectBid(input: CocoAuctionBidIntent & { operationId: string }): Promise<CocoEngineBidProjection | null>
	cancelPreparedBid(operationId: string, account: CocoAuctionAccountIdentity): Promise<void>
	executeBid(input: CocoAuctionBidIntent & { operationId: string }): Promise<CocoEngineBidProjection>
	withBidPublicationMaterial<T>(
		input: CocoAuctionBidIntent & { operationId: string },
		use: (material: SealedCocoBidPublicationMaterial) => Promise<T>,
	): Promise<T>
	releaseWinner<T>(
		input: CocoAuctionWinnerReleaseInput,
		use: (material: SealedCocoWinnerReleaseMaterial) => Promise<T>,
	): Promise<{ operationId: string; result: T }>
	receiveWinner(input: CocoAuctionWinnerReceiveInput, encodedToken: string): Promise<{ operationId: string; state: 'finalized' }>
	refundLosingBid(input: CocoAuctionRefundInput): Promise<{ operationId: string; state: 'refunded' }>
}

export interface CocoBidPublicationAdapter {
	/** Build, sign, and durably cache one exact kind-1023 without broadcasting it. */
	prepare(
		material: SealedCocoBidPublicationMaterial,
		intent: CocoAuctionBidIntent,
		publicationCreatedAt: number,
	): Promise<{ eventId: string }>
	/** Broadcast the exact cached event. Repeated calls must not build a new event. */
	publish(eventId: string): Promise<void>
}

export interface CocoWinnerReleasePublicationAdapter {
	/** Build, sign, and durably cache one exact kind-1025 without broadcasting it. */
	prepare(
		material: SealedCocoWinnerReleaseMaterial,
		input: CocoAuctionWinnerReleaseInput,
		publicationCreatedAt: number,
	): Promise<{ eventId: string }>
	/** Broadcast the exact cached event. */
	publish(eventId: string): Promise<void>
}

export interface CocoSettlementPublicationAdapter {
	/** Build, sign, and durably cache one exact kind-1024 without broadcasting it. */
	prepare(input: CocoAuctionWinnerReceiveInput, publicationCreatedAt: number): Promise<{ eventId: string }>
	/** Broadcast the exact cached event and require a relay acknowledgement. */
	publish(eventId: string): Promise<void>
}

export class CocoV2CoreUnavailableError extends Error {
	constructor() {
		super('Coco v2 Auction engine is unavailable: the pinned Core adapter could not be initialized.')
		this.name = 'CocoV2CoreUnavailableError'
	}
}

/**
 * Fail-closed placeholder used when the sealed pinned Core adapter cannot be
 * initialized. It never delegates to NIP-60.
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
