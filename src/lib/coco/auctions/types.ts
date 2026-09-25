export type CocoAuctionUnit = 'sat'

export type CocoAuctionBusinessStatus =
	| 'requested'
	| 'preparing'
	| 'prepared'
	| 'cancelling'
	| 'cancelled'
	| 'executing'
	| 'executed'
	| 'publication_ready'
	| 'published'
	| 'releasing'
	| 'released'
	| 'receiving'
	| 'received'
	| 'refunding'
	| 'refunded'
	| 'failed'

export interface CocoAuctionAccountIdentity {
	/** Canonical lowercase hex Nostr pubkey. */
	accountPubkey: string
	/** Explicit deployment/account namespace such as `local` or `auctionsdev`. */
	environmentId: string
}

export interface CocoAuctionReference {
	/** Immutable kind-30408 root event id. */
	rootEventId: string
	/** Addressable identity `30408:<seller-pubkey>:<d>`. */
	coordinate: string
}

export interface CocoAuctionSellerAuthority {
	account: CocoAuctionAccountIdentity
	/** Public-only HD authority placed in the canonical Auction event. */
	publicP2pkAuthority: string
	status: 'ready'
}

export interface CocoAuctionBidIntent {
	commandId: string
	account: CocoAuctionAccountIdentity
	auction: CocoAuctionReference
	bidderPubkey: string
	sellerPubkey: string
	/** Seller HD xpub copied from the canonical kind-30408 event. */
	sellerPublicAuthority: string
	mintUrl: string
	unit: CocoAuctionUnit
	/** Cumulative kind-1023 bid amount. */
	grossAmount: number
	/** Monetary amount locked by this Send operation (the rebid delta). */
	amount: number
	locktime: number
	createdForEndAt: number
	previousBidEventId?: string
}

export interface CocoAuctionBidProjection {
	commandId: string
	operationId: string
	account: CocoAuctionAccountIdentity
	auction: CocoAuctionReference
	bidderPubkey: string
	sellerPubkey: string
	sellerPublicAuthority: string
	mintUrl: string
	unit: CocoAuctionUnit
	grossAmount: number
	amount: number
	fee: number
	locktime: number
	recipientPublicAuthority: string
	refundPublicAuthority: string
	conditionFingerprint: string
	commitmentFingerprint: string
	status: CocoAuctionBusinessStatus
	publicationEventId?: string
}

export interface CocoAuctionCancelResult {
	commandId: string
	operationId: string
	status: 'cancelled'
}

export interface CocoAuctionWinnerReleaseInput {
	commandId: string
	account: CocoAuctionAccountIdentity
	auction: CocoAuctionReference
	winningBidEventId: string
	winningBidderPubkey: string
	sellerPubkey: string
	sendOperationId: string
}

export interface CocoAuctionWinnerReleaseResult {
	commandId: string
	operationId: string
	pathReleaseEventId: string
	status: 'released'
}

export interface CocoAuctionWinnerReceiveInput {
	commandId: string
	account: CocoAuctionAccountIdentity
	auction: CocoAuctionReference
	winningBidEventId: string
	winningBidderPubkey: string
	sellerPubkey: string
	pathReleaseEventId: string
	senderOperationId: string
	mintUrl: string
	unit: CocoAuctionUnit
	amount: number
	conditionFingerprint: string
	derivationPath: string
	recipientPublicAuthority: string
	tokenFingerprint: string
}

export interface CocoAuctionWinnerReceiveResult {
	commandId: string
	operationId: string
	settlementEventId: string
	status: 'published'
}

export interface CocoAuctionRefundInput {
	commandId: string
	account: CocoAuctionAccountIdentity
	auction: CocoAuctionReference
	bidEventId: string
	bidderPubkey: string
	sendOperationId: string
	locktime: number
}

export interface CocoAuctionRefundResult {
	commandId: string
	operationId: string
	status: 'refunded'
}
