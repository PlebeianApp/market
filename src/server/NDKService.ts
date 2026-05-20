import NDK, { type NDKSubscription } from '@nostr-dev-kit/ndk'
import { naddrFromAddress } from '../lib/nostr/naddr'
import type { AdminManager, EditorManager, BootstrapManager } from './types'

export class NDKService {
	private ndk: NDK | null = null
	private appPubkey: string
	private adminManager: AdminManager
	private editorManager: EditorManager
	private bootstrapManager: BootstrapManager
	private adminSubscription: NDKSubscription | null = null
	private editorSubscription: NDKSubscription | null = null
	private latestAdminEventTime = 0
	private latestEditorEventTime = 0

	constructor(appPubkey: string, adminManager: AdminManager, editorManager: EditorManager, bootstrapManager: BootstrapManager) {
		this.appPubkey = appPubkey
		this.adminManager = adminManager
		this.editorManager = editorManager
		this.bootstrapManager = bootstrapManager
	}

	public async initialize(relayUrl?: string): Promise<void> {
		if (!relayUrl) return

		try {
			this.ndk = new NDK({ explicitRelayUrls: [relayUrl] })
			await this.ndk.connect()
			console.log('NDK service connected to relay:', relayUrl)
		} catch (e) {
			console.error('Failed to connect to relay for initialization', e)
		}
	}

	public async loadExistingData(): Promise<void> {
		if (!this.ndk) return

		await Promise.all([this.checkExistingSetupEvent(), this.loadExistingAdminList(), this.loadExistingEditorList()])
	}

	private async checkExistingSetupEvent(): Promise<void> {
		if (!this.ndk) return

		try {
			const setupEvents = await this.ndk.fetchEvents({
				kinds: [31990],
				authors: [this.appPubkey],
				limit: 1,
			})

			const firstEvent = setupEvents.values().next().value
			if (firstEvent) {
				console.log('Found existing setup event')

				try {
					const settings = JSON.parse(firstEvent.content)
					if (settings.ownerPk) {
						this.adminManager.addAdmin(settings.ownerPk)
					}
				} catch (e) {
					console.error('Failed to parse existing setup event', e)
				}
			}
		} catch (e) {
			console.error('Failed to check for existing setup event', e)
		}
	}

	private async loadExistingAdminList(): Promise<void> {
		if (!this.ndk) return

		try {
			const naddr = naddrFromAddress(30000, this.appPubkey, 'admins')
			const latestAdminEvent = await this.ndk.fetchEvent(naddr)
			if (latestAdminEvent) {
				console.log('Found existing admin list, updating internal list')
				this.adminManager.updateFromEvent(latestAdminEvent)
				this.latestAdminEventTime = latestAdminEvent.created_at ?? 0
			}
		} catch (e) {
			console.error('Failed to load existing admin list', e)
		}
	}

	private async loadExistingEditorList(): Promise<void> {
		if (!this.ndk) return

		try {
			const naddr = naddrFromAddress(30000, this.appPubkey, 'editors')
			const latestEditorEvent = await this.ndk.fetchEvent(naddr)
			if (latestEditorEvent) {
				console.log('Found existing editor list, updating internal list')
				this.editorManager.updateFromEvent(latestEditorEvent)
				this.latestEditorEventTime = latestEditorEvent.created_at ?? 0
			}
		} catch (e) {
			console.error('Failed to load existing editor list', e)
		}
	}

	/**
	 * Open long-lived subscriptions on the app relay for admin and editor list updates.
	 * Without this, the in-memory admin/editor caches only refresh when the bun proxy
	 * itself processes a publish for these kinds — direct relay publishes (via nak or
	 * other clients) wouldn't propagate, and the authorization gate stays stale.
	 */
	public startSubscriptions(): void {
		if (!this.ndk) return

		this.adminSubscription = this.ndk.subscribe({ kinds: [30000], authors: [this.appPubkey], '#d': ['admins'] }, { closeOnEose: false })
		this.adminSubscription.on('event', (event) => {
			const ts = event.created_at ?? 0
			if (ts <= this.latestAdminEventTime) return
			this.latestAdminEventTime = ts
			console.log(`Live admin list update received (created_at=${ts})`)
			this.adminManager.updateFromEvent(event)
		})

		this.editorSubscription = this.ndk.subscribe({ kinds: [30000], authors: [this.appPubkey], '#d': ['editors'] }, { closeOnEose: false })
		this.editorSubscription.on('event', (event) => {
			const ts = event.created_at ?? 0
			if (ts <= this.latestEditorEventTime) return
			this.latestEditorEventTime = ts
			console.log(`Live editor list update received (created_at=${ts})`)
			this.editorManager.updateFromEvent(event)
		})
	}

	public shutdown(): void {
		this.adminSubscription?.stop()
		this.editorSubscription?.stop()
		this.adminSubscription = null
		this.editorSubscription = null
		if (this.ndk) {
			this.ndk = null
		}
	}
}
