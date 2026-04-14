import { finalizeEvent, getPublicKey, nip44, SimplePool } from 'nostr-tools'
import type { Event } from 'nostr-tools'

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
	private pool: SimplePool
	private relays: string[]
	private serverPubkey: string
	private pendingRequests: Map<string, PendingRequest> = new Map()
	private activeSubs: any[] = []

	constructor(options: { privateKey: Uint8Array; relays: string[]; serverPubkey: string }) {
		this.privateKey = options.privateKey
		this.publicKey = getPublicKey(options.privateKey)
		this.relays = options.relays
		this.serverPubkey = options.serverPubkey
		this.pool = new SimplePool()
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

		const sub = this.pool.subscribeMany(this.relays, { kinds: [GIFT_WRAP_KIND], '#p': [this.publicKey], limit: 20 } as any, {
			onevent: (event: Event) => {
				this.handleGiftWrapResponse(event)
			},
		})

		this.activeSubs.push(sub)
	}

	private async handleGiftWrapResponse(event: Event): Promise<void> {
		try {
			console.info('ContextVM candidate response event', {
				eventId: event.id,
				pubkey: event.pubkey,
				kind: event.kind,
				tags: event.tags,
			})
			const conversationKey = nip44.v2.utils.getConversationKey(this.privateKey, event.pubkey)
			const decrypted = nip44.v2.decrypt(event.content, conversationKey)
			const innerEvent = JSON.parse(decrypted) as Event
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

		const publishPromises = this.relays.map((relay) => Promise.resolve(this.pool.publish([relay], signedGiftWrap)).catch(() => {}))

		await Promise.allSettled(publishPromises)

		console.info('ContextVM request published', {
			requestId: mcpMessage.id,
			giftWrapId: signedGiftWrap.id,
			innerEventId: signedInner.id,
		})

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
				sub.close()
			} catch {}
		}
		this.activeSubs = []

		this.pool.close(this.relays)
	}
}
