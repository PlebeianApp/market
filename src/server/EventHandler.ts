import type { NostrEvent } from '@nostr-dev-kit/ndk'
import type { EventHandlerConfig, ProcessedEvent } from './types'
import { AdminManagerImpl } from './AdminManager'
import { EditorManagerImpl } from './EditorManager'
import { BootstrapManagerImpl } from './BootstrapManager'
import { BlacklistManagerImpl } from './BlacklistManager'
import { EventValidator } from './EventValidator'
import { EventSigner } from './EventSigner'
import { NDKService } from './NDKService'
import NDK from '@nostr-dev-kit/ndk'

export class EventHandler {
	private static instance: EventHandler
	private isInitialized: boolean = false

	// Core components
	private adminManager: AdminManagerImpl
	private editorManager: EditorManagerImpl
	private bootstrapManager: BootstrapManagerImpl
	private blacklistManager: BlacklistManagerImpl
	private eventValidator: EventValidator
	private eventSigner: EventSigner
	private ndkService: NDKService

	private constructor() {
		// Initialize with empty managers - components requiring private key will be set up during initialize()
		this.adminManager = new AdminManagerImpl()
		this.editorManager = new EditorManagerImpl()
		this.bootstrapManager = new BootstrapManagerImpl(this.adminManager)
		// These will be properly initialized in the initialize() method
		this.eventValidator = null as any
		this.eventSigner = null as any
		this.ndkService = null as any
		this.blacklistManager = null as any
	}

	public static getInstance(): EventHandler {
		if (!EventHandler.instance) {
			EventHandler.instance = new EventHandler()
		}
		return EventHandler.instance
	}

	public async initialize(config: EventHandlerConfig): Promise<void> {
		if (this.isInitialized) {
			throw new Error('EventHandler is already initialized')
		}

		// Initialize core components
		this.adminManager = new AdminManagerImpl(config.adminPubkeys)
		this.editorManager = new EditorManagerImpl()
		this.bootstrapManager = new BootstrapManagerImpl(this.adminManager, config.adminPubkeys.length)
		this.eventSigner = new EventSigner(config.appPrivateKey)
		this.eventValidator = new EventValidator(config.appPrivateKey, this.adminManager, this.editorManager, this.bootstrapManager)
		this.ndkService = new NDKService(this.eventSigner.getAppPubkey(), this.adminManager, this.editorManager, this.bootstrapManager)
		this.blacklistManager = new BlacklistManagerImpl(this.eventSigner, this.ndkService)

		// Initialize NDK service and load existing data
		await this.ndkService.initialize(config.relayUrl)
		await this.ndkService.loadExistingData()

		// Set up NDK for blacklist manager and load existing blacklist
		if (config.relayUrl) {
			const ndk = new NDK({ explicitRelayUrls: [config.relayUrl] })
			await ndk.connect()
			this.blacklistManager.setNDK(ndk)
			await this.blacklistManager.loadExistingBlacklist(this.eventSigner.getAppPubkey())
		}

		this.isInitialized = true
		console.log('EventHandler initialized successfully')
	}

	public handleEvent(event: NostrEvent): NostrEvent | null {
		if (!this.isInitialized) {
			throw new Error('EventHandler is not initialized')
		}

		const processed = this.processEvent(event)
		return processed.signedEvent
	}

	public processEvent(event: NostrEvent): ProcessedEvent {
		if (!this.isInitialized || !this.eventValidator || !this.eventSigner) {
			throw new Error('EventHandler is not initialized')
		}

		// Validate the event
		const validationResult = this.eventValidator.validateEvent(event)

		if (!validationResult.isValid) {
			console.log(validationResult.reason)
			return {
				originalEvent: event,
				signedEvent: null,
				validationResult,
			}
		}

		// Handle special event types that update internal state
		// Note: handleSpecialEvents is async for blacklist processing, but we don't await to maintain sync API
		this.handleSpecialEvents(event).catch((error) => {
			console.error('Error handling special event:', error)
		})

		// Sign the event
		const signedEvent = this.eventSigner.signEvent(event)

		return {
			originalEvent: event,
			signedEvent,
			validationResult,
		}
	}

	private async handleSpecialEvents(event: NostrEvent): Promise<void> {
		const isSetupEvent = event.kind === 31990 && event.content.includes('"name":')
		const isAdminListEvent = event.kind === 30000 && event.tags.some((tag) => tag[0] === 'd' && tag[1] === 'admins')
		const isEditorListEvent = event.kind === 30000 && event.tags.some((tag) => tag[0] === 'd' && tag[1] === 'editors')
		const isBlacklistEvent = event.kind === 10000

		if (isSetupEvent) {
			this.bootstrapManager.handleSetupEvent(event)
		} else if (isAdminListEvent) {
			console.log('Admin list event accepted, updating internal admin list')
			this.adminManager.updateFromEvent(event)
		} else if (isEditorListEvent) {
			console.log('Editor list event accepted, updating internal editor list')
			this.editorManager.updateFromEvent(event)
		} else if (isBlacklistEvent) {
			console.log('Blacklist event accepted, processing blacklist update')
			await this.blacklistManager.handleBlacklistEvent(event)
		}
	}

	// Public API methods
	public addAdmin(pubkey: string): void {
		if (!this.isInitialized) {
			throw new Error('EventHandler is not initialized')
		}
		this.adminManager.addAdmin(pubkey)
	}

	public addEditor(pubkey: string): void {
		if (!this.isInitialized) {
			throw new Error('EventHandler is not initialized')
		}
		this.editorManager.addEditor(pubkey)
	}

	public isAdmin(pubkey: string): boolean {
		return this.adminManager.isAdmin(pubkey)
	}

	public isEditor(pubkey: string): boolean {
		return this.editorManager.isEditor(pubkey)
	}

	public isAdminOrEditor(pubkey: string): boolean {
		return this.isAdmin(pubkey) || this.isEditor(pubkey)
	}

	public isBootstrapMode(): boolean {
		return this.bootstrapManager.isBootstrapMode()
	}

	public isBlacklisted(pubkey: string): boolean {
		if (!this.isInitialized) {
			throw new Error('EventHandler is not initialized')
		}
		return this.blacklistManager.isBlacklisted(pubkey)
	}

	public getBlacklistedPubkeys(): string[] {
		if (!this.isInitialized) {
			throw new Error('EventHandler is not initialized')
		}
		return this.blacklistManager.getBlacklistedPubkeys()
	}

	public getStats() {
		return {
			adminCount: this.adminManager.size(),
			editorCount: this.editorManager.size(),
			blacklistedPubkeys: this.isInitialized ? this.blacklistManager.getBlacklistedPubkeys().length : 0,
			isBootstrapMode: this.bootstrapManager.isBootstrapMode(),
			isInitialized: this.isInitialized,
		}
	}

	public shutdown(): void {
		if (this.ndkService) {
			this.ndkService.shutdown()
		}
		this.isInitialized = false
		console.log('EventHandler shut down')
	}
}

// Export singleton instance getter - call getInstance() to get the instance
// Note: Don't create the instance immediately to avoid initialization errors
export const getEventHandler = () => EventHandler.getInstance()
