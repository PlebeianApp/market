import type { NostrEvent } from '@nostr-dev-kit/ndk'
import type { EventHandlerConfig, ProcessedEvent } from './types'
import { AdminManagerImpl } from './AdminManager'
import { EditorManagerImpl } from './EditorManager'
import { BootstrapManagerImpl } from './BootstrapManager'
import { BlacklistManagerImpl } from './BlacklistManager'
import { VanityManagerImpl } from './VanityManager'
import { Nip05ManagerImpl } from './Nip05Manager'
import { EventValidator } from './EventValidator'
import { EventSigner } from './EventSigner'
import { NDKService } from './NDKService'
import NDK from '@nostr-dev-kit/ndk'
import { ZAP_RELAYS } from '../lib/constants'
import type { ZapPurchaseManager, ZapPurchaseEntry } from './ZapPurchaseManager'

export class EventHandler {
	private static instance: EventHandler
	private isInitialized: boolean = false

	// Core components
	private adminManager: AdminManagerImpl
	private editorManager: EditorManagerImpl
	private bootstrapManager: BootstrapManagerImpl
	private blacklistManager: BlacklistManagerImpl
	private vanityManager: VanityManagerImpl
	private nip05Manager: Nip05ManagerImpl
	private eventValidator: EventValidator
	private eventSigner: EventSigner
	private ndkService: NDKService
	private ndk: NDK | null = null
	private zapNdk: NDK | null = null
	private handledZapReceiptIds: Set<string> = new Set()

	// Registered zap purchase managers (vanity URLs, nip05)
	private purchaseManagers: ZapPurchaseManager<ZapPurchaseEntry>[] = []

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
		this.vanityManager = null as any
		this.nip05Manager = null as any
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
		this.vanityManager = new VanityManagerImpl(this.eventSigner)
		this.nip05Manager = new Nip05ManagerImpl(this.eventSigner)

		// Register all zap purchase managers
		this.purchaseManagers = [this.vanityManager, this.nip05Manager]

		// Initialize NDK service and load existing data with timeout
		try {
			await Promise.race([
				this.ndkService.initialize(config.relayUrl),
				new Promise((_, reject) => setTimeout(() => reject(new Error('NDK service init timeout')), 10000)),
			])
		} catch (e) {
			console.warn('⚠️ NDK service init failed, continuing anyway:', e)
		}

		try {
			await Promise.race([
				this.ndkService.loadExistingData(),
				new Promise((_, reject) => setTimeout(() => reject(new Error('Load existing data timeout')), 10000)),
			])
		} catch (e) {
			console.warn('⚠️ Load existing data failed, continuing anyway:', e)
		}

		// Set up NDK for blacklist and vanity managers
		if (config.relayUrl) {
			this.ndk = new NDK({ explicitRelayUrls: [config.relayUrl] })
			try {
				await Promise.race([
					this.ndk.connect(),
					new Promise((_, reject) => setTimeout(() => reject(new Error('App relay NDK connect timeout')), 10000)),
				])

				// Initialize blacklist
				this.blacklistManager.setNDK(this.ndk)
				await this.blacklistManager.loadExistingBlacklist(this.eventSigner.getAppPubkey())

				// Initialize vanity
				this.vanityManager.setNDK(this.ndk)
				await this.vanityManager.loadExistingVanityRegistry(this.eventSigner.getAppPubkey())

				// Initialize NIP-05
				this.nip05Manager.setNDK(this.ndk)
				await this.nip05Manager.loadExistingNip05Registry(this.eventSigner.getAppPubkey())

				// Subscribe to zap receipts for all purchase managers (app relay)
				this.subscribeToZapPurchases(this.ndk, 'App relay')
			} catch (e) {
				console.warn('⚠️ App relay NDK setup failed, continuing anyway:', e)
			}

			// Also subscribe on dedicated zap relays; some LSPs do not publish receipts to the app relay.
			const zapRelayUrls = Array.from(new Set([config.relayUrl, ...ZAP_RELAYS].filter(Boolean)))
			console.log(`Connecting to zap relays: ${zapRelayUrls.join(', ')}`)
			this.zapNdk = new NDK({ explicitRelayUrls: zapRelayUrls })
			try {
				await Promise.race([
					this.zapNdk.connect(),
					new Promise((_, reject) => setTimeout(() => reject(new Error('Zap relay connection timeout')), 15000)),
				])
				this.subscribeToZapPurchases(this.zapNdk, 'Zap relays')
			} catch (error) {
				console.warn('⚠️ Failed to connect zap relay NDK; zap purchase receipts may not be processed:', error)
				// Subscribe anyway in case some relays connected
				this.subscribeToZapPurchases(this.zapNdk, 'Zap relays (partial)')
			}
		}

		this.isInitialized = true
		console.log('EventHandler initialized successfully')
	}

	/**
	 * Subscribe to zap receipts for all registered purchase managers.
	 * Each manager self-filters by its own label tag, so a single subscription
	 * routes receipts to vanity URLs, badges, NIP-05.
	 */
	private subscribeToZapPurchases(ndk: NDK, label: string): void {
		const appPubkey = this.eventSigner.getAppPubkey()

		// Subscribe to zap receipts where app pubkey is the recipient
		const sub = ndk.subscribe(
			{
				kinds: [9735],
				'#p': [appPubkey],
			},
			{ closeOnEose: false },
		)

		sub.on('event', async (event) => {
			try {
				if (event.id) {
					if (this.handledZapReceiptIds.has(event.id)) return
					this.handledZapReceiptIds.add(event.id)
					if (this.handledZapReceiptIds.size > 2000) {
						// Simple bound to avoid unbounded growth
						this.handledZapReceiptIds.clear()
						this.handledZapReceiptIds.add(event.id)
					}
				}
				// Route to all purchase managers; each filters by its own label
				const raw = event.rawEvent()
				for (const manager of this.purchaseManagers) {
					await manager.handleZapReceipt(raw)
				}
			} catch (error) {
				console.error('Error handling zap purchase receipt:', error)
			}
		})

		console.log(`Subscribed to zap purchase receipts (${label})`)
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

		// Route registry events to matching purchase managers
		for (const manager of this.purchaseManagers) {
			if (
				event.kind === manager.config.registryEventKind &&
				event.tags.some((tag) => tag[0] === 'd' && tag[1] === manager.config.registryDTag)
			) {
				console.log(`Registry event accepted for [${manager.config.registryDTag}]`)
				await manager.handleRegistryEvent(event)
			}
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

	/**
	 * Get a registered purchase manager by its zap label.
	 * Used by invoice route handlers to delegate to the correct manager.
	 */
	public getPurchaseManager(zapLabel: string): ZapPurchaseManager<ZapPurchaseEntry> | undefined {
		return this.purchaseManagers.find((m) => m.config.zapLabel === zapLabel)
	}

	/**
	 * Get the vanity URL purchase manager.
	 */
	public getVanityManager(): VanityManagerImpl {
		return this.vanityManager
	}

	/**
	 * Get the NIP-05 purchase manager.
	 */
	public getNip05Manager(): Nip05ManagerImpl {
		return this.nip05Manager
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
