import type { NDKEvent, NostrEvent } from '@nostr-dev-kit/ndk'
import { getPublicKey } from 'nostr-tools'
import { finalizeEvent, type UnsignedEvent } from 'nostr-tools/pure'
import NDK from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'
import { bytesFromHex } from './utils/keyConversion'

export class EventHandler {
	private static instance: EventHandler
	private adminPubkeys: Set<string> = new Set()
	private appPrivateKey: string = ''
	private isInitialized: boolean = false
	private bootstrapMode: boolean = false
	private hasSetupEvent: boolean = false
	private ndk: NDK | null = null

	private constructor() {}

	public static getInstance(): EventHandler {
		if (!EventHandler.instance) {
			EventHandler.instance = new EventHandler()
		}
		return EventHandler.instance
	}

	private async checkExistingSetupEvent() {
		if (!this.ndk) return

		try {
			const appPubkey = getPublicKey(Buffer.from(this.appPrivateKey, 'hex'))

			const setupEvents = await this.ndk.fetchEvents({
				kinds: [31990],
				authors: [appPubkey],
				limit: 1,
			})

			const firstEvent = setupEvents.values().next().value
			if (firstEvent) {
				this.hasSetupEvent = true
				console.log('Found existing setup event')

				try {
					const settings = JSON.parse(firstEvent.content)
					if (settings.ownerPk) {
						this.addAdmin(settings.ownerPk)
					}
				} catch (e) {
					console.error('Failed to parse existing setup event', e)
				}
			}

			await this.loadExistingAdminList()
		} catch (e) {
			console.error('Failed to check for existing setup event', e)
		}
	}

	private async loadExistingAdminList() {
		if (!this.ndk) return

		try {
			const appPubkey = getPublicKey(Buffer.from(this.appPrivateKey, 'hex'))

			const adminEvents = await this.ndk.fetchEvents({
				kinds: [30000],
				authors: [appPubkey],
				'#d': ['admins'],
				limit: 1,
			})

			const latestAdminEvent = adminEvents.values().next().value
			if (latestAdminEvent) {
				console.log('Found existing admin list, updating internal list')
				this.updateAdminListFromEvent(latestAdminEvent)
			}
		} catch (e) {
			console.error('Failed to load existing admin list', e)
		}
	}

	public async initialize(appPrivateKey: string, adminPubkeys: string[], relayUrl?: string) {
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

		await this.checkExistingSetupEvent()
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

	private updateAdminListFromEvent(event: NostrEvent | NDKEvent): void {
		try {
			// Extract admin pubkeys from 'p' tags in the admin list event
			const newAdmins = event.tags.filter((tag) => tag[0] === 'p' && tag[1] && tag[1].length === 64).map((tag) => tag[1])

			// Replace the current admin list with the new one
			this.adminPubkeys.clear()
			newAdmins.forEach((pubkey) => this.adminPubkeys.add(pubkey))

			console.log(`Updated admin list with ${newAdmins.length} admins:`, newAdmins)
		} catch (error) {
			console.error('Failed to update admin list from event:', error)
		}
	}

	public handleEvent(event: NostrEvent): NostrEvent | null {
		if (!this.isInitialized) {
			throw new Error('EventHandler is not initialized')
		}

		const isSetupEvent = event.kind === 31990 && event.content.includes('"name":')
		const isAdminListEvent = event.kind === 30000 && event.tags.some((tag) => tag[0] === 'd' && tag[1] === 'admins')
		const isEditorListEvent = event.kind === 30000 && event.tags.some((tag) => tag[0] === 'd' && tag[1] === 'editors')
		const isRoleListEvent = isAdminListEvent || isEditorListEvent

		if (isSetupEvent) {
			const appPubkey = getPublicKey(bytesFromHex(this.appPrivateKey))
			if (!this.bootstrapMode && event.pubkey !== appPubkey && !this.adminPubkeys.has(event.pubkey)) {
				console.log('Setup event rejected: not in bootstrap mode and not signed by app or admin')
				return null
			}

			if (!this.hasSetupEvent) {
				this.hasSetupEvent = true
				console.log('First setup event received and validated')
			} else {
				console.log('Subsequent setup event received and validated from admin')
			}
		}

		// Allow role list events (admins/editors) during bootstrap or from existing admins
		if (isRoleListEvent) {
			if (!this.bootstrapMode && !this.adminPubkeys.has(event.pubkey)) {
				console.log('Role list event rejected: not in bootstrap mode and not from admin')
				return null
			}

			// Update internal admin list when admin list events are processed
			if (isAdminListEvent) {
				console.log('Admin list event accepted, updating internal admin list')
				this.updateAdminListFromEvent(event)
			} else if (isEditorListEvent) {
				console.log('Editor list event accepted')
			}
		}

		// For other events, check admin status
		if (!isSetupEvent && !isRoleListEvent && !this.adminPubkeys.has(event.pubkey)) {
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
			this.bootstrapMode = false

			try {
				const settings = JSON.parse(event.content)
				if (settings.ownerPk) {
					let pubkey = settings.ownerPk
					if (pubkey.startsWith('npub')) {
						const { data } = nip19.decode(pubkey)
						pubkey = data.toString()
					}
					this.addAdmin(pubkey)
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
		this.hasSetupEvent = false
	}
}

export const eventHandler = EventHandler.getInstance()
