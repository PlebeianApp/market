/**
 * NIP-46 remote signer mock for e2e testing.
 *
 * Uses a raw WebSocket connection (instead of nostr-tools Relay) to avoid
 * the "mute: no one was listening" error that nostr-tools throws on
 * unexpected relay messages.
 *
 * Supports both NIP-04 and NIP-44 encryption (NDK defaults to NIP-44).
 *
 * Uses a single unified message handler to avoid event-loss race conditions
 * that occur when multiple handlers are added/removed at different times.
 *
 * Implements both the QR-code handshake (nostrconnect:// flow) and the
 * ongoing signer loop (connect, get_public_key, sign_event) so that
 * NDKNip46Signer.blockUntilReady() can complete against the local relay.
 */

import { finalizeEvent, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'
import { encrypt as nip04Encrypt, decrypt as nip04Decrypt } from 'nostr-tools/nip04'
import { v2 as nip44 } from 'nostr-tools/nip44'
import WebSocket from 'ws'
import { RELAY_URL } from '../test-config'

export class Nip46Mock {
	/** Hex secret key of the "remote signer" user */
	readonly sk: string
	/** Hex public key */
	readonly pk: string

	private ws: WebSocket | null = null
	private subId: string | null = null

	// ─── Unified message dispatch ─────────────────────────────
	// Single handler attached once — routes messages to the right callback.
	private eoseResolve: (() => void) | null = null
	private okCallbacks = new Map<string, (ok: boolean, reason?: string) => void>()
	private eventHandler: ((event: any) => Promise<void>) | null = null
	private bufferedEvents: any[] = []

	constructor(userSk: string) {
		this.sk = userSk
		this.pk = getPublicKey(hexToBytes(userSk))
	}

	// ─── Encryption helpers ────────────────────────────────────

	/** Auto-detect encryption scheme and decrypt */
	private async decryptContent(senderPubkey: string, content: string): Promise<string> {
		if (content.includes('?iv=')) {
			return await nip04Decrypt(this.sk, senderPubkey, content)
		}
		try {
			const conversationKey = nip44.utils.getConversationKey(hexToBytes(this.sk), senderPubkey)
			return nip44.decrypt(content, conversationKey)
		} catch {
			return await nip04Decrypt(this.sk, senderPubkey, content)
		}
	}

	/** Encrypt with NIP-04 */
	private async encryptContent(recipientPubkey: string, plaintext: string): Promise<string> {
		return await nip04Encrypt(this.sk, recipientPubkey, plaintext)
	}

	// ─── Single message handler ───────────────────────────────

	/**
	 * The ONE message handler, attached at WebSocket open and never removed.
	 * Routes messages to the appropriate callback based on type.
	 */
	private handleMessage = (data: WebSocket.RawData) => {
		const msg = JSON.parse(data.toString())

		switch (msg[0]) {
			case 'EOSE':
				if (msg[1] === this.subId && this.eoseResolve) {
					const resolve = this.eoseResolve
					this.eoseResolve = null
					resolve()
				}
				break

			case 'OK': {
				const eventId = msg[1]
				const cb = this.okCallbacks.get(eventId)
				if (cb) {
					this.okCallbacks.delete(eventId)
					cb(!!msg[2], msg[3])
				}
				break
			}

			case 'EVENT':
				if (msg[1] === this.subId) {
					const event = msg[2]
					if (this.eventHandler) {
						this.eventHandler(event).catch((e) => {
							console.error(`[NIP46-MOCK] Handler error:`, e)
						})
					} else {
						// Buffer events that arrive before the handler is set
						this.bufferedEvents.push(event)
					}
				}
				break
		}
	}

	// ─── Connection helpers ────────────────────────────────────

	/** Open WebSocket, attach unified handler, subscribe, wait for EOSE */
	private async connectAndSubscribe(relayUrl: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(relayUrl)
			this.ws = ws
			this.subId = 'nip46_mock_' + Date.now()

			ws.on('error', (err) => {
				reject(new Error(`WebSocket error: ${err.message}`))
			})

			ws.on('open', () => {
				// Attach the single unified handler
				ws.on('message', this.handleMessage)

				// Set up EOSE callback
				this.eoseResolve = resolve as () => void

				// Subscribe to Kind 24133 events addressed to our pubkey
				ws.send(JSON.stringify(['REQ', this.subId, { kinds: [24133], '#p': [this.pk] }]))
			})

			setTimeout(() => reject(new Error('Timeout connecting to relay')), 10_000)
		})
	}

	/** Set the event handler and drain any buffered events */
	private setEventHandler(handler: (event: any) => Promise<void>): void {
		this.eventHandler = handler
		// Process any events that arrived before the handler was set
		const buffered = this.bufferedEvents.splice(0)
		for (const event of buffered) {
			handler(event).catch((e) => {
				console.error(`[NIP46-MOCK] Handler error (buffered):`, e)
			})
		}
	}

	/** Publish an event via the WebSocket and wait for OK */
	private publishEvent(event: any): Promise<{ accepted: boolean; reason?: string }> {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error('WebSocket not connected'))
		}

		return new Promise((resolve) => {
			this.okCallbacks.set(event.id, (ok, reason) => {
				resolve({ accepted: ok, reason })
			})
			this.ws!.send(JSON.stringify(['EVENT', event]))

			setTimeout(() => {
				if (this.okCallbacks.has(event.id)) {
					this.okCallbacks.delete(event.id)
					resolve({ accepted: true }) // Assume success on timeout
				}
			}, 5_000)
		})
	}

	// ─── QR-code flow ──────────────────────────────────────────

	/**
	 * Complete the nostrconnect:// handshake and start the signer loop.
	 *
	 * 1. Parse the nostrconnect:// URL for localPubkey, relay, token
	 * 2. Connect to relay and subscribe
	 * 3. Set up event handler for responses
	 * 4. Publish a `connect` request with the token
	 * 5. Event handler processes approval → sends ack
	 * 6. Event handler processes signer requests (connect, get_public_key, sign_event)
	 *
	 * Returns a cleanup function.
	 */
	async respondToConnect(nostrconnectUrl: string): Promise<() => void> {
		const withoutProtocol = nostrconnectUrl.replace('nostrconnect://', '')
		const qIdx = withoutProtocol.indexOf('?')
		const localPubkey = withoutProtocol.slice(0, qIdx)
		const params = new URLSearchParams(withoutProtocol.slice(qIdx + 1))
		const relayUrl = params.get('relay')!
		const token = params.get('token')!

		// Connect and wait for subscription EOSE
		await this.connectAndSubscribe(relayUrl)

		let qrHandshakeDone = false

		// Set up event handler (also drains any buffered events)
		this.setEventHandler(async (event) => {
			const decrypted = await this.decryptContent(event.pubkey, event.content)
			const msg = JSON.parse(decrypted)

			if (!qrHandshakeDone && msg.result !== undefined && !msg.method) {
				// App's approval response to our connect request
				qrHandshakeDone = true
				await this.sendEncrypted(localPubkey, { result: 'ack' })
			} else if (msg.method) {
				// Signer request from NDKNip46Signer
				await this.handleSignerRequest(event.pubkey, msg)
			}
		})

		// Publish the connect request
		const connectRequest = {
			id: crypto.randomUUID(),
			method: 'connect',
			params: { token },
		}
		await this.sendEncrypted(localPubkey, connectRequest)

		return () => this.close()
	}

	// ─── Bunker URL flow ───────────────────────────────────────

	/**
	 * Start listening for NIP-46 signer requests on the relay.
	 * Used when testing bunker:// URL connections where the app
	 * directly creates NDKNip46Signer without a QR handshake.
	 *
	 * Returns a cleanup function.
	 */
	async startSignerLoop(relayUrl?: string): Promise<() => void> {
		await this.connectAndSubscribe(relayUrl || RELAY_URL)

		this.setEventHandler(async (event) => {
			const decrypted = await this.decryptContent(event.pubkey, event.content)
			const msg = JSON.parse(decrypted)

			if (msg.method) {
				await this.handleSignerRequest(event.pubkey, msg)
			}
		})

		return () => this.close()
	}

	// ─── Internals ─────────────────────────────────────────────

	private async handleSignerRequest(senderPubkey: string, request: any): Promise<void> {
		let response: any

		switch (request.method) {
			case 'connect':
				response = { id: request.id, result: 'ack' }
				break

			case 'get_public_key':
				response = { id: request.id, result: this.pk }
				break

			case 'sign_event': {
				const eventToSign = typeof request.params[0] === 'string' ? JSON.parse(request.params[0]) : request.params[0]
				const signed = finalizeEvent(eventToSign, hexToBytes(this.sk))
				response = { id: request.id, result: JSON.stringify(signed) }
				break
			}

			case 'nip04_encrypt': {
				const [thirdPartyPubkey, plaintext] = request.params
				const ciphertext = await nip04Encrypt(this.sk, thirdPartyPubkey, plaintext)
				response = { id: request.id, result: ciphertext }
				break
			}

			case 'nip04_decrypt': {
				const [thirdPartyPubkey2, ciphertext2] = request.params
				const plaintext2 = await nip04Decrypt(this.sk, thirdPartyPubkey2, ciphertext2)
				response = { id: request.id, result: plaintext2 }
				break
			}

			default:
				response = { id: request.id, error: `Unsupported method: ${request.method}` }
		}

		await this.sendEncrypted(senderPubkey, response)
	}

	/**
	 * Encrypt content and publish as a Kind 24133 event.
	 * Retries on "mute" rejections (no matching subscription yet) with
	 * a fresh event each time to avoid duplicate-event deduplication.
	 */
	private async sendEncrypted(recipientPubkey: string, content: object, maxRetries = 10): Promise<void> {
		const plaintext = JSON.stringify(content)

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			const encrypted = await this.encryptContent(recipientPubkey, plaintext)
			const template: EventTemplate = {
				kind: 24133,
				created_at: Math.floor(Date.now() / 1000),
				content: encrypted,
				tags: [['p', recipientPubkey]],
			}
			const event = finalizeEvent(template, hexToBytes(this.sk))
			const result = await this.publishEvent(event)

			if (result.accepted) {
				return
			}

			if (result.reason?.includes('mute') && attempt < maxRetries - 1) {
				await new Promise((r) => setTimeout(r, 500))
				continue
			}

			throw new Error(`Relay rejected event: ${result.reason}`)
		}
	}

	close(): void {
		if (this.ws && this.subId) {
			try {
				if (this.ws.readyState === WebSocket.OPEN) {
					this.ws.send(JSON.stringify(['CLOSE', this.subId]))
				}
			} catch (_) {}
		}

		try {
			this.ws?.close()
		} catch (_) {}
		this.ws = null
		this.subId = null
		this.eventHandler = null
		this.bufferedEvents = []
		this.okCallbacks.clear()
	}
}
