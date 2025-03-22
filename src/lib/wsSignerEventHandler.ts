import type { NostrEvent } from '@nostr-dev-kit/ndk'
import { getPublicKey } from 'nostr-tools'
import { finalizeEvent, type UnsignedEvent } from 'nostr-tools/pure'

export class EventHandler {
	private static instance: EventHandler
	private adminPubkeys: Set<string> = new Set()
	private appPrivateKey: string = ''
	private isInitialized: boolean = false
	private bootstrapMode: boolean = false

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
		this.appPrivateKey = appPrivateKey
		this.adminPubkeys = new Set(adminPubkeys)
		this.isInitialized = true

		this.bootstrapMode = adminPubkeys.length === 0
		if (this.bootstrapMode) {
			console.log('Event handler initialized in bootstrap mode')
		}
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

		const isSetupEvent = event.kind === 31990 && event.content.includes('"name":')
		if (!this.adminPubkeys.has(event.pubkey) && !(this.bootstrapMode && isSetupEvent)) {
			return null
		}

		const privateBytes = new Uint8Array(Buffer.from(this.appPrivateKey, 'hex'))
		const newEvent: UnsignedEvent = {
			kind: event.kind as number,
			created_at: event.created_at,
			tags: event.tags,
			content: event.content,
			pubkey: getPublicKey(privateBytes),
		}

		if (this.bootstrapMode && isSetupEvent) {
			console.log('Exiting bootstrap mode after successful app setup')
			this.bootstrapMode = false

			try {
				const settings = JSON.parse(event.content)
				if (settings.ownerPk) {
					this.addAdmin(settings.ownerPk)
				}
			} catch (e) {
				console.error('Failed to parse settings during bootstrap', e)
			}
		}

		return finalizeEvent(newEvent, privateBytes)
	}

	public isAdmin(pubkey: string): boolean {
		return this.adminPubkeys.has(pubkey)
	}

	public isBootstrapMode(): boolean {
		return this.bootstrapMode
	}

	public reset() {
		this.adminPubkeys.clear()
		this.appPrivateKey = ''
		this.isInitialized = false
		this.bootstrapMode = false
	}
}

export const eventHandler = EventHandler.getInstance()
