import NDK from '@nostr-dev-kit/ndk'
import { naddrFromAddress } from '../lib/nostr/naddr'
import type { AdminManager, EditorManager, BootstrapManager } from './types'

export class NDKService {
	private ndk: NDK | null = null
	private appPubkey: string
	private adminManager: AdminManager
	private editorManager: EditorManager
	private bootstrapManager: BootstrapManager

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
			}
		} catch (e) {
			console.error('Failed to load existing editor list', e)
		}
	}

	public shutdown(): void {
		if (this.ndk) {
			this.ndk = null
		}
	}
}
