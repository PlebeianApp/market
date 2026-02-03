import type { NostrEvent } from '@nostr-dev-kit/ndk'
import type { EventHandlerConfig, ProcessedEvent } from './types'
import { AdminManagerImpl } from './AdminManager'
import { EditorManagerImpl } from './EditorManager'
import { BootstrapManagerImpl } from './BootstrapManager'
import { BlacklistManagerImpl } from './BlacklistManager'
import { VanityManagerImpl } from './VanityManager'
import { EventValidator } from './EventValidator'
import { EventSigner } from './EventSigner'
import { NDKService } from './NDKService'
import NDK, { type NDKSubscription } from '@nostr-dev-kit/ndk'
import { ZAP_RELAYS } from '../lib/constants'
import { Invoice } from '@getalby/lightning-tools'
import { confirmVanityInvoice, getPendingVanityInvoice, wasVanityInvoiceConfirmed } from './vanityInvoices'

export class EventHandler {
	private static instance: EventHandler
	private isInitialized: boolean = false

	// Core components
	private adminManager: AdminManagerImpl
	private editorManager: EditorManagerImpl
	private bootstrapManager: BootstrapManagerImpl
	private blacklistManager: BlacklistManagerImpl
	private vanityManager: VanityManagerImpl
	private eventValidator: EventValidator
	private eventSigner: EventSigner
	private ndkService: NDKService
	private ndk: NDK | null = null
	private zapNdk: NDK | null = null
	private handledZapReceiptIds: Set<string> = new Set()
	private vanityZapSubscriptions: NDKSubscription[] = []
	private zapReceiptSince: number = 0

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
		this.vanityManager = new VanityManagerImpl(this.eventSigner, this.ndkService)

		// Initialize NDK service and load existing data
		await this.ndkService.initialize(config.relayUrl)
		await this.ndkService.loadExistingData()

		// Set up NDK for blacklist and vanity managers
		if (config.relayUrl) {
			// Don't re-process historical receipts on startup (especially during Bun HMR reloads).
			// Allow a small lookback to catch receipts that arrived during initialization.
			this.zapReceiptSince = Math.floor(Date.now() / 1000) - 15

			this.ndk = new NDK({ explicitRelayUrls: [config.relayUrl] })
			await this.ndk.connect()

			// Initialize blacklist
			this.blacklistManager.setNDK(this.ndk)
			await this.blacklistManager.loadExistingBlacklist(this.eventSigner.getAppPubkey())

			// Initialize vanity
			this.vanityManager.setNDK(this.ndk)
			await this.vanityManager.loadExistingVanityRegistry(this.eventSigner.getAppPubkey())

			// Subscribe to zap receipts for vanity registration (app relay)
			this.subscribeToVanityZaps(this.ndk, 'App relay', this.zapReceiptSince)

			// Also subscribe on dedicated zap relays; some LSPs do not publish receipts to the app relay.
			const zapRelayUrls = Array.from(new Set([config.relayUrl, ...ZAP_RELAYS].filter(Boolean)))
			console.log(`Connecting to zap relays: ${zapRelayUrls.join(', ')}`)
			this.zapNdk = new NDK({ explicitRelayUrls: zapRelayUrls })
			try {
				await Promise.race([
					this.zapNdk.connect(),
					new Promise((_, reject) => setTimeout(() => reject(new Error('Zap relay connection timeout')), 15000)),
				])
				this.subscribeToVanityZaps(this.zapNdk, 'Zap relays')
			} catch (error) {
				console.warn('⚠️ Failed to connect zap relay NDK; vanity zap receipts may not be processed:', error)
				// Try to subscribe anyway in case some relays connected
				this.subscribeToVanityZaps(this.zapNdk, 'Zap relays (partial)')
			}
		}

		this.isInitialized = true
		console.log('EventHandler initialized successfully')
	}

	/**
	 * Subscribe to zap receipts for vanity URL registration
	 */
	private subscribeToVanityZaps(ndk: NDK, label: string, since?: number): void {
		const appPubkey = this.eventSigner.getAppPubkey()

		// Subscribe to zap receipts where app pubkey is the recipient
		const sub = ndk.subscribe(
			{
				kinds: [9735],
				'#p': [appPubkey],
				...(since ? { since } : {}),
			},
			{ closeOnEose: false },
		)

			sub.on('event', async (event) => {
				try {
					if (since && (event.created_at ?? 0) < since) {
						// Some relays ignore `since` filters; double-check to avoid replaying old receipts.
						return
					}
					if (process.env.VANITY_DEBUG === 'true') {
						console.log(`⚡ Zap receipt event received (${label}):`, {
							id: event.id,
							p: event.tagValue('p'),
							bolt11: event.tagValue('bolt11')?.substring(0, 24)
								? `${event.tagValue('bolt11')!.substring(0, 24)}…`
								: undefined,
						})
					}
					if (event.id) {
						if (this.handledZapReceiptIds.has(event.id)) return
						this.handledZapReceiptIds.add(event.id)
						if (this.handledZapReceiptIds.size > 2000) {
						// Simple bound to avoid unbounded growth
						this.handledZapReceiptIds.clear()
						this.handledZapReceiptIds.add(event.id)
					}
				}
				await this.vanityManager.handleZapReceipt(event.rawEvent())
			} catch (error) {
				console.error('Error handling vanity zap receipt:', error)
			}
		})

		this.vanityZapSubscriptions.push(sub)
		console.log(`Subscribed to vanity zap receipts (${label})`)
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
		const isVanityListEvent = event.kind === 30000 && event.tags.some((tag) => tag[0] === 'd' && tag[1] === 'vanity-urls')
		const isBlacklistEvent = event.kind === 10000

		if (isSetupEvent) {
			this.bootstrapManager.handleSetupEvent(event)
		} else if (isAdminListEvent) {
			console.log('Admin list event accepted, updating internal admin list')
			this.adminManager.updateFromEvent(event)
		} else if (isEditorListEvent) {
			console.log('Editor list event accepted, updating internal editor list')
			this.editorManager.updateFromEvent(event)
		} else if (isVanityListEvent) {
			console.log('Vanity list event accepted, updating vanity registry')
			await this.vanityManager.handleVanityEvent(event)
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
		for (const sub of this.vanityZapSubscriptions) {
			try {
				sub.stop()
			} catch (error) {
				console.warn('Failed to stop vanity zap subscription:', error)
			}
		}
		this.vanityZapSubscriptions = []

		try {
			this.ndk?.pool?.relays?.forEach((relay) => relay.disconnect())
		} catch (error) {
			console.warn('Failed to disconnect app relay NDK:', error)
		}

		try {
			this.zapNdk?.pool?.relays?.forEach((relay) => relay.disconnect())
		} catch (error) {
			console.warn('Failed to disconnect zap relay NDK:', error)
		}

		if (this.ndkService) {
			this.ndkService.shutdown()
		}
		this.isInitialized = false
		console.log('EventHandler shut down')
	}

	/**
	 * Confirm a vanity invoice payment using a preimage.
	 * This is used for invoices issued by the backend where the wallet provides a preimage (NWC/WebLN).
	 */
	public async confirmVanityInvoicePayment(bolt11: string, preimage: string): Promise<{ vanityName: string; validUntil: number }> {
		if (!this.isInitialized) {
			throw new Error('EventHandler is not initialized')
		}

		const pending = getPendingVanityInvoice(bolt11)
		if (!pending) {
			if (wasVanityInvoiceConfirmed(bolt11)) {
				throw new Error('Invoice already confirmed')
			}
			throw new Error('Unknown or expired invoice')
		}

		let isValid = false
		try {
			const invoice = new Invoice({ pr: bolt11 })
			isValid = invoice.validatePreimage(preimage)
		} catch {
			isValid = false
		}

		if (!isValid) {
			throw new Error('Invalid preimage for invoice')
		}

		confirmVanityInvoice(bolt11)

		const validUntil = await this.vanityManager.registerVanityPurchase(pending.vanityName, pending.requesterPubkey, pending.amountSats)
		if (!validUntil) {
			throw new Error('Failed to register vanity purchase')
		}

		return { vanityName: pending.vanityName, validUntil }
	}
}

// Export singleton instance getter - call getInstance() to get the instance
// Note: Don't create the instance immediately to avoid initialization errors
export const getEventHandler = () => EventHandler.getInstance()
