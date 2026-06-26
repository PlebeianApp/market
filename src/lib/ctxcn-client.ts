import { finalizeEvent, getPublicKey, nip44 } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools/pure'
import { RelayLiveness, RelayPool } from 'applesauce-relay'

const CTXVM_MESSAGES_KIND = 25910
const GIFT_WRAP_KIND = 1059
const TIMEOUT_MS = 20000

type PendingRequest = {
	resolve: (value: any) => void
	reject: (reason: any) => void
	timer: ReturnType<typeof setTimeout>
}

function uuidv4(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID()
	}
	const bytes = new Uint8Array(16)
	crypto.getRandomValues(bytes)
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export class PlebianCurrencyClient {
	private privateKey: Uint8Array
	private publicKey: string
	private pool: RelayPool
	private liveness: RelayLiveness
	private relays: string[]
	private serverPubkey: string
	private pendingRequests: Map<string, PendingRequest> = new Map()
	private activeSubs: { unsubscribe: () => void }[] = []

	constructor(options: { privateKey: Uint8Array; relays: string[]; serverPubkey: string }) {
		this.privateKey = options.privateKey
		this.publicKey = getPublicKey(options.privateKey)
		this.relays = options.relays
		this.serverPubkey = options.serverPubkey
		// applesauce-relay pool: subscriptions auto-reconnect, publishes retry,
		// and RelayLiveness tracks per-relay health so dead relays are skipped.
		this.pool = new RelayPool()
		this.liveness = new RelayLiveness({ maxFailuresBeforeDead: 3 })
		this.liveness.connectToPool(this.pool)
	}

	/**
	 * Relays that are currently usable (not dead, not in backoff).
	 * On a cold start liveness has not observed any relay yet, so every
	 * configured relay is returned and the first request still goes out.
	 */
	healthyRelays(): string[] {
		return this.liveness.filter(this.relays)
	}

	/**
	 * True when every configured relay is known to liveness and none are
	 * currently usable. Callers can use this to short-circuit straight to an
	 * HTTPS fallback instead of waiting out a timeout. Returns false on a cold
	 * start (relays not yet observed) so the first request is always attempted.
	 */
	allRelaysUnhealthy(): boolean {
		if (this.relays.length === 0) return true
		return this.liveness.filter(this.relays).length === 0
	}

	async callTool(params: { name: string; arguments: Record<string, any> }): Promise<any> {
		const requestId = uuidv4()
		const mcpRequest = {
			jsonrpc: '2.0' as const,
			id: requestId,
			method: 'tools/call',
			params: {
				name: params.name,
				arguments: params.arguments,
			},
		}

		this.subscribeForResponses()

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(requestId)
				console.warn(`ContextVM request ${requestId} timed out after ${TIMEOUT_MS}ms`)
				reject(new Error('Request timed out'))
			}, TIMEOUT_MS)

			this.pendingRequests.set(requestId, { resolve, reject, timer })

			console.info('ContextVM request queued', {
				requestId,
				serverPubkey: this.serverPubkey,
				clientPubkey: this.publicKey,
				relays: this.relays,
				healthyRelays: this.healthyRelays(),
			})

			void (async () => {
				await new Promise((resolve) => setTimeout(resolve, 1500))
				await this.sendEncryptedMessage(mcpRequest)
			})().catch((error) => {
				this.pendingRequests.delete(requestId)
				clearTimeout(timer)
				reject(error)
			})
		})
	}

	private subscribeForResponses(): void {
		if (this.activeSubs.length > 0) return

		console.info('ContextVM response subscription active', {
			clientPubkey: this.publicKey,
			serverPubkey: this.serverPubkey,
			relays: this.relays,
		})

		// Long-lived REQ across every configured relay. reconnect: Infinity keeps
		// retrying connection errors forever (survives transient relay drops);
		// resubscribe: true re-opens the REQ if a relay sends a clean CLOSED.
		const events$ = this.pool.subscription(
			this.relays,
			{ kinds: [GIFT_WRAP_KIND], '#p': [this.publicKey], limit: 20 },
			{ reconnect: Infinity, resubscribe: true },
		)

		const sub = events$.subscribe({
			next: (event: NostrEvent) => {
				this.handleGiftWrapResponse(event)
			},
			error: (error: unknown) => {
				console.warn('ContextVM response subscription errored:', error)
			},
		})

		this.activeSubs.push(sub)
	}

	private async handleGiftWrapResponse(event: NostrEvent): Promise<void> {
		try {
			console.info('ContextVM candidate response event', {
				eventId: event.id,
				pubkey: event.pubkey,
				kind: event.kind,
				tags: event.tags,
			})
			const conversationKey = nip44.v2.utils.getConversationKey(this.privateKey, event.pubkey)
			const decrypted = nip44.v2.decrypt(event.content, conversationKey)
			const innerEvent = JSON.parse(decrypted) as NostrEvent
			const mcpMessage = JSON.parse(innerEvent.content)
			const responseId = mcpMessage.id || innerEvent.tags?.find((t: string[]) => t[0] === 'e')?.[1]
			console.info('ContextVM response received', {
				eventId: event.id,
				innerEventId: innerEvent.id,
				responseId,
				requestMethod: mcpMessage.method,
				hasResult: Boolean(mcpMessage.result),
				hasError: Boolean(mcpMessage.isError),
			})

			if (!responseId) return

			const pending = this.pendingRequests.get(responseId)
			if (!pending) return

			this.pendingRequests.delete(responseId)
			clearTimeout(pending.timer)

			const structured = mcpMessage.result?.structuredContent || mcpMessage.result

			if (mcpMessage.isError) {
				const errorMsg = structured?.error || 'Unknown error'
				pending.reject(new Error(errorMsg))
				return
			}

			if (structured?.error) {
				pending.reject(new Error(structured.error))
				return
			}

			pending.resolve(structured)
		} catch (error) {
			console.warn('ContextVM response handling failed:', error)
		}
	}

	private async sendEncryptedMessage(mcpMessage: any): Promise<{ giftWrapId: string; innerEventId: string }> {
		const innerEvent = {
			pubkey: this.publicKey,
			kind: CTXVM_MESSAGES_KIND,
			tags: [['p', this.serverPubkey]],
			content: JSON.stringify(mcpMessage),
			created_at: Math.floor(Date.now() / 1000),
		}

		const signedInner = finalizeEvent(innerEvent, this.privateKey)

		const giftWrapPrivateKey = crypto.getRandomValues(new Uint8Array(32))
		const giftWrapPublicKey = getPublicKey(giftWrapPrivateKey)
		const conversationKey = nip44.v2.utils.getConversationKey(giftWrapPrivateKey, this.serverPubkey)
		const encryptedContent = nip44.v2.encrypt(JSON.stringify(signedInner), conversationKey)

		const giftWrap = {
			kind: GIFT_WRAP_KIND,
			content: encryptedContent,
			tags: [['p', this.serverPubkey]],
			created_at: Math.floor(Date.now() / 1000),
			pubkey: giftWrapPublicKey,
		}

		const signedGiftWrap = finalizeEvent(giftWrap, giftWrapPrivateKey)

		// Only publish to relays liveness considers usable, so a dead relay no
		// longer blocks the request. publish() retries each relay (default 3x)
		// and resolves once the relay accepts the EVENT.
		const relays = this.healthyRelays()
		if (relays.length === 0) {
			console.warn('ContextVM publish skipped — no healthy relays', {
				requestId: mcpMessage.id,
				giftWrapId: signedGiftWrap.id,
			})
			return { giftWrapId: signedGiftWrap.id, innerEventId: signedInner.id }
		}

		try {
			const responses = await this.pool.publish(relays, signedGiftWrap)
			const okCount = responses.filter((r) => r.ok).length
			console.info('ContextVM request published', {
				requestId: mcpMessage.id,
				giftWrapId: signedGiftWrap.id,
				innerEventId: signedInner.id,
				publishedTo: responses.map((r) => r.from),
				ok: `${okCount}/${responses.length}`,
			})
		} catch (error) {
			// publish() rejects only when every relay failed to accept the event;
			// the pending request simply times out and the caller falls back to Yadio.
			console.warn('ContextVM publish failed on all relays:', error)
		}

		return { giftWrapId: signedGiftWrap.id, innerEventId: signedInner.id }
	}

	close(): void {
		this.pendingRequests.forEach((pending) => {
			clearTimeout(pending.timer)
			pending.reject(new Error('Client closed'))
		})
		this.pendingRequests.clear()

		for (const sub of this.activeSubs) {
			try {
				sub.unsubscribe()
			} catch {}
		}
		this.activeSubs = []

		try {
			this.liveness.disconnectFromPool(this.pool)
		} catch {}
		this.pool.close()
	}
}
