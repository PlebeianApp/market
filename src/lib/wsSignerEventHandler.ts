import type { NostrEvent } from '@nostr-dev-kit/ndk'
import { finalizeEvent, type Event, type UnsignedEvent } from 'nostr-tools/pure'
import { getPublicKey } from 'nostr-tools'

export class EventHandler {
	private static instance: EventHandler
	private adminPubkeys: Set<string> = new Set()
	private appPrivateKey: string = ''
	private isInitialized: boolean = false

	private constructor() {}

	public static getInstance(): EventHandler {
		if (!EventHandler.instance) {
			EventHandler.instance = new EventHandler()
		}
		return EventHandler.instance
	}

	public async initialize(appPrivateKey: string, adminPubkeys: string[]) {
		if (this.isInitialized) {
			throw new Error('EventHandler is already initialized')
		}
		console.log('initializing event handler')
		this.appPrivateKey = appPrivateKey
		this.adminPubkeys = new Set(adminPubkeys)
		this.isInitialized = true
	}

	public addAdmin(pubkey: string): void {
		if (!this.isInitialized) {
			throw new Error('EventHandler is not initialized')
		}

		if (typeof pubkey !== 'string' || pubkey.length !== 64) {
			throw new Error('Invalid public key format')
		}

		this.adminPubkeys.add(pubkey)
	}

	public handleEvent(event: NostrEvent): NostrEvent | null {
		if (!this.isInitialized) {
			throw new Error('EventHandler is not initialized')
		}

		if (!this.adminPubkeys.has(event.pubkey)) {
			return null
		}

		const privateBytes = new Uint8Array(Buffer.from(this.appPrivateKey, 'hex'))
		// Create a new event with the same content but signed by the app
		const newEvent: UnsignedEvent = {
			kind: event.kind as number,
			created_at: event.created_at,
			tags: event.tags,
			content: event.content,
			pubkey: getPublicKey(privateBytes),
		}

		// Finalize and sign the event with the app private key
		return finalizeEvent(newEvent, privateBytes)
	}

	public isAdmin(pubkey: string): boolean {
		return this.adminPubkeys.has(pubkey)
	}

	// For testing purposes
	public reset() {
		this.adminPubkeys.clear()
		this.appPrivateKey = ''
		this.isInitialized = false
	}
}

export const eventHandler = EventHandler.getInstance()
