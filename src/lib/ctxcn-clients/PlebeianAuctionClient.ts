import { finalizeEvent, getPublicKey, nip44, SimplePool, type Event, type EventTemplate } from 'nostr-tools'
import { NDKEvent, NDKUser, type NDKSigner } from '@nostr-dev-kit/ndk'
import type NDK from '@nostr-dev-kit/ndk'

/**
 * Browser-safe ContextVM client for the `english_auction_path_oracle_v1`
 * tool family.
 *
 * Why this exists alongside the ctxcn-generated `PlebeianServerClient`:
 * the generated client pulls in `@contextvm/sdk`, whose logger calls
 * `pino.destination()` at module init — that's a Node-only API. Bundling
 * the SDK into the browser explodes on first import. Until the SDK ships
 * a browser-safe build, the React app uses this hand-rolled client; the
 * seed scripts (Bun runtime, Node-compatible) keep using the generated
 * `PlebeianServerClient`.
 *
 * Wire format is identical to what the SDK / ctxcn produces:
 *   - Inner event: kind 25910, content = JSON-RPC `tools/call`, signed
 *     by the bidder/seller (their NDK signer).
 *   - Outer event: kind 1059 gift-wrap, NIP-44 encrypted to the
 *     facilitator's pubkey, signed with an ephemeral key per send.
 *   - Response: kind 1059 from the facilitator addressed to the caller
 *     (#p), decrypted and the inner event's content parsed as JSON-RPC.
 *
 * Methods mirror `PlebeianServerClient`'s PascalCase + positional signatures
 * for the four auction tools so call sites stay consistent across the two
 * implementations.
 */

const CTXVM_MESSAGES_KIND = 25910
const GIFT_WRAP_KIND = 1059
const EPHEMERAL_GIFT_WRAP_KIND = 21059
const TIMEOUT_MS = 20_000

// -- Public input/output types -----------------------------------------
// Mirrors `src/lib/ctxcn-clients/PlebeianServerClient.ts`. Kept as a
// duplicate (not imported) because importing PlebeianServerClient would
// pull in the SDK and reintroduce the pino crash.

export interface RequestPathOutput {
	grantId: string
	derivationPath: string
	childPubkey: string
	xpub: string
	pathIssuerPubkey: string
	issuedAt: number
	expiresAt: number
	acceptedFloor: number
}

export interface SubmitBidTokenOutput {
	bidEventId: string
	registryStatus: 'locked' | 'rejected'
	rejectReason?: string
}

export interface SettlementReleaseEntry {
	bidEventId: string
	derivationPath: string
	childPubkey: string
	bidderPubkey: string
	mintUrl: string
	amount: number
	totalBidAmount: number
	commitment: string
	locktime: number
	refundPubkey: string
	token: string
}

export interface RequestSettlementOutput {
	status: 'settled' | 'reserve_not_met' | 'cancelled'
	closeAt: number
	reserve: number
	finalAmount: number
	winningBidEventId: string
	winnerPubkey: string
	releaseId?: string
	releases: SettlementReleaseEntry[]
}

export interface GetAuctionStateOutput {
	phase: 'scheduled' | 'active' | 'closing' | 'ended'
	startAt: number
	endAt: number
	effectiveEndAt: number
	maxEndAt: number
	currentFloor: number
	topBidAmount: number
	bidCount: number
	pathsIssued: number
	pathsLocked: number
}

// -- Internal correlation type -----------------------------------------

type PendingRequest<T = unknown> = {
	resolve: (value: T) => void
	reject: (reason: Error) => void
	timer: ReturnType<typeof setTimeout>
}

interface Subscription {
	close: () => void
}

// -- Client -------------------------------------------------------------

export interface PlebeianAuctionClientOptions {
	/** NDK signer for the bidder/seller — signs the inner kind-25910 event. */
	signer: NDKSigner
	/** NDK instance — used for signing inner events via NDKEvent. */
	ndk: NDK
	/** Operational relays. The same relays the facilitator is reachable on. */
	relays: string[]
	/** Facilitator pubkey. Typically the auction's `path_issuer` tag value. */
	serverPubkey: string
}

export class PlebeianAuctionClient {
	private readonly opts: PlebeianAuctionClientOptions
	private readonly pool: SimplePool
	private readonly pendingRequests = new Map<string, PendingRequest>()
	private activeSubs: Subscription[] = []
	private clientPubkey: string | null = null

	constructor(opts: PlebeianAuctionClientOptions) {
		this.opts = opts
		this.pool = new SimplePool()
	}

	private async getClientPubkey(): Promise<string> {
		if (this.clientPubkey) return this.clientPubkey
		const user = await this.opts.signer.user()
		this.clientPubkey = user.pubkey
		return this.clientPubkey
	}

	private subscribeForResponses(clientPubkey: string): void {
		if (this.activeSubs.length > 0) return
		// Listen for both persistent (1059) and ephemeral (21059) gift wraps.
		// The server is configured for `GiftWrapMode.PERSISTENT` so 1059 is
		// what we expect — but a stale session promotion in the SDK or a
		// future config change could surface 21059, and we'd rather ignore
		// it gracefully (decrypt failure → log) than miss a legitimate
		// response and time out at 20s.
		const sub = this.pool.subscribeMany(
			this.opts.relays,
			{ kinds: [GIFT_WRAP_KIND, EPHEMERAL_GIFT_WRAP_KIND], '#p': [clientPubkey], limit: 20 } as Parameters<SimplePool['subscribeMany']>[1],
			{
				onevent: (event: Event) => {
					void this.handleGiftWrapResponse(event)
				},
			},
		)
		this.activeSubs.push(sub as Subscription)
	}

	private async handleGiftWrapResponse(event: Event): Promise<void> {
		try {
			const decryptable = new NDKEvent(this.opts.ndk, event)
			await decryptable.decrypt(new NDKUser({ pubkey: event.pubkey }), this.opts.signer, 'nip44')
			const innerEvent = JSON.parse(decryptable.content) as Event
			const mcpMessage = JSON.parse(innerEvent.content) as { id?: string; result?: { structuredContent?: unknown }; isError?: boolean }
			const responseId = typeof mcpMessage.id === 'string' ? mcpMessage.id : undefined
			if (!responseId) return
			const pending = this.pendingRequests.get(responseId)
			if (!pending) return
			this.pendingRequests.delete(responseId)
			clearTimeout(pending.timer)

			const structured = (mcpMessage.result?.structuredContent ?? mcpMessage.result) as Record<string, unknown> | undefined
			if (mcpMessage.isError) {
				const errMessage = typeof structured?.error === 'string' ? structured.error : 'Tool returned an error'
				pending.reject(new Error(errMessage))
				return
			}
			if (structured && typeof structured === 'object' && 'error' in structured && typeof (structured as { error?: unknown }).error === 'string') {
				pending.reject(new Error((structured as { error: string }).error))
				return
			}
			pending.resolve(structured)
		} catch (error) {
			console.warn('PlebeianAuctionClient: failed to handle response', error)
		}
	}

	private async sendEncryptedMessage(mcpMessage: {
		jsonrpc: '2.0'
		id: string
		method: string
		params: { name: string; arguments: Record<string, unknown> }
	}): Promise<void> {
		// Inner event signed by the user's NDK signer.
		const innerEvent = new NDKEvent(this.opts.ndk)
		innerEvent.kind = CTXVM_MESSAGES_KIND
		innerEvent.tags = [['p', this.opts.serverPubkey]]
		innerEvent.content = JSON.stringify(mcpMessage)
		innerEvent.created_at = Math.floor(Date.now() / 1000)
		await innerEvent.sign(this.opts.signer)
		const signedInnerRaw = innerEvent.rawEvent()
		const signedInner: Event = {
			id: signedInnerRaw.id || innerEvent.id,
			pubkey: signedInnerRaw.pubkey,
			created_at: signedInnerRaw.created_at,
			kind: signedInnerRaw.kind,
			tags: signedInnerRaw.tags,
			content: signedInnerRaw.content,
			sig: signedInnerRaw.sig || innerEvent.sig || '',
		}

		// Gift-wrap (kind 1059) signed with an ephemeral key. Encrypted
		// with NIP-44 so only the facilitator can read the inner event.
		const giftWrapPrivateKey = crypto.getRandomValues(new Uint8Array(32))
		const giftWrapPublicKey = getPublicKey(giftWrapPrivateKey)
		const conversationKey = nip44.v2.utils.getConversationKey(giftWrapPrivateKey, this.opts.serverPubkey)
		const encryptedContent = nip44.v2.encrypt(JSON.stringify(signedInner), conversationKey)

		const giftWrapTemplate: EventTemplate & { pubkey: string } = {
			kind: GIFT_WRAP_KIND,
			content: encryptedContent,
			tags: [['p', this.opts.serverPubkey]],
			created_at: Math.floor(Date.now() / 1000),
			pubkey: giftWrapPublicKey,
		}
		const signedGiftWrap = finalizeEvent(giftWrapTemplate, giftWrapPrivateKey)

		await Promise.allSettled(
			this.opts.relays.map((relay) => Promise.resolve(this.pool.publish([relay], signedGiftWrap)).catch(() => undefined)),
		)
	}

	private async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
		const requestId = crypto.randomUUID()
		const clientPubkey = await this.getClientPubkey()
		this.subscribeForResponses(clientPubkey)

		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(requestId)
				reject(new Error(`PlebeianAuctionClient: ${name} timed out after ${TIMEOUT_MS}ms`))
			}, TIMEOUT_MS)

			this.pendingRequests.set(requestId, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timer,
			})

			// `jsonrpc: '2.0'` is REQUIRED. The server-side `NostrServerTransport`
			// validates with `isJSONRPCRequest`, which uses a strict zod schema
			// (`jsonrpc: z.literal("2.0")`). Without this field the message is
			// silently dropped — no response, no error — and the client would
			// time out at `TIMEOUT_MS`. Mirrors `PlebianCurrencyClient.callTool`,
			// which has always sent the field.
			void this.sendEncryptedMessage({
				jsonrpc: '2.0',
				id: requestId,
				method: 'tools/call',
				params: { name, arguments: args },
			}).catch((error) => {
				this.pendingRequests.delete(requestId)
				clearTimeout(timer)
				reject(error instanceof Error ? error : new Error(String(error)))
			})
		})
	}

	// -- Public API (matches PlebeianServerClient's auction methods) ----

	async RequestPath(
		auctionEventId: string,
		auctionCoordinates: string,
		bidderRefundPubkey: string,
		intendedAmount: number,
	): Promise<RequestPathOutput> {
		return this.callTool<RequestPathOutput>('request_path', {
			auctionEventId,
			auctionCoordinates,
			bidderRefundPubkey,
			intendedAmount,
		})
	}

	async SubmitBidToken(
		auctionEventId: string,
		auctionCoordinates: string,
		bidEventId: string,
		grantId: string,
		lockPubkey: string,
		refundPubkey: string,
		mintUrl: string,
		amount: number,
		totalBidAmount: number,
		commitment: string,
		bidNonce: string,
		locktime: number,
		token: string,
	): Promise<SubmitBidTokenOutput> {
		return this.callTool<SubmitBidTokenOutput>('submit_bid_token', {
			auctionEventId,
			auctionCoordinates,
			bidEventId,
			grantId,
			lockPubkey,
			refundPubkey,
			mintUrl,
			amount,
			totalBidAmount,
			commitment,
			bidNonce,
			locktime,
			token,
		})
	}

	async RequestSettlement(auctionEventId: string, auctionCoordinates?: string): Promise<RequestSettlementOutput> {
		return this.callTool<RequestSettlementOutput>('request_settlement', {
			auctionEventId,
			auctionCoordinates,
		})
	}

	async GetAuctionState(auctionEventId: string): Promise<GetAuctionStateOutput> {
		return this.callTool<GetAuctionStateOutput>('get_auction_state', { auctionEventId })
	}

	disconnect(): void {
		for (const pending of Array.from(this.pendingRequests.values())) {
			clearTimeout(pending.timer)
			pending.reject(new Error('PlebeianAuctionClient: client closed'))
		}
		this.pendingRequests.clear()
		for (const sub of this.activeSubs) {
			try {
				sub.close()
			} catch {
				// already closed
			}
		}
		this.activeSubs = []
		try {
			this.pool.close(this.opts.relays)
		} catch {
			// pool already closed
		}
	}
}
