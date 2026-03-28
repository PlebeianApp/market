import type { NostrEvent } from '@nostr-dev-kit/ndk'
import NDK, { NDKEvent } from '@nostr-dev-kit/ndk'
import type { EventSigner } from './EventSigner'

/**
 * Pricing tier for a purchasable item.
 */
export interface PricingTier {
	sats: number
	days: number
	seconds?: number
	label: string
}

/**
 * Base interface for any zap-purchased registry entry.
 * All purchase types track the buyer's pubkey and expiration.
 */
export interface ZapPurchaseEntry {
	pubkey: string
	validUntil: number // Unix timestamp
}

/**
 * Request body for generating a zap purchase invoice.
 * Used by the generic `/api/<purchase>/` route handler.
 */
export interface ZapPurchaseInvoiceRequestBody {
	amountSats: number
	/** Purchase-specific key (e.g. vanity name, badge tier, username) */
	registryKey: string
	zapRequest: {
		pubkey: string
		sig?: string
		created_at?: number
		kind?: number
		content?: string
		tags: string[][]
	}
}

/**
 * Successful invoice generation result.
 */
export interface ZapInvoiceResult {
	pr: string
}

/**
 * Response from a LNURL-pay endpoint (LUD-06/LUD-16).
 */
export interface LnurlPayData {
	callback?: string
	maxSendable?: number
	minSendable?: number
	commentAllowed?: number
	allowsNostr?: boolean
	nostrPubkey?: string
	status?: 'ERROR'
	reason?: string
}

/**
 * Response from a LNURL-pay callback containing the BOLT11 invoice.
 */
export interface LnurlInvoiceData {
	pr?: string
	status?: 'ERROR'
	reason?: string
}

/**
 * Function that converts a Lightning identifier (lud16/lud06) to an LNURL-pay endpoint URL.
 */
export type LnurlResolver = (lightningIdentifier: string) => string

/**
 * Configuration for a zap purchase manager instance.
 *
 * @example
 * // Vanity URL purchase config
 * {
 *   zapLabel: 'vanity-register',
 *   registryEventKind: 30000,
 *   registryDTag: 'vanity-urls',
 *   pricing: {
 *     '6mo': { sats: 10000, days: 180, label: '6 Months' },
 *     '1yr': { sats: 18000, days: 365, label: '1 Year' },
 *   },
 * }
 */
export interface ZapPurchaseConfig {
	/** L tag to identifying this purchase type (like: "vanity-register") */
	zapLabel: string
	/** Nostr event kind for the registry (e.g. 30000) */
	registryEventKind: number
	/** d-tag value for the registry event (e.g. "vanity-urls") */
	registryDTag: string
	/** Available pricing tiers */
	pricing: Record<string, PricingTier>
	/** Max age in seconds for processing zap receipts (default: 300) */
	maxReceiptAge?: number
}

/**
 *  Abstract base for all zap purchases:
 * - Subscribtion -> Payment Validation  -> Publishing the parameterized Nostr events
 *
 * Subclasses implement domain-specific logic:
 *  - extract the registry and specific validation rules and serialization Nostr event tags
 *
 * @example
 * // Create a supporter badge purchase manager
 * class BadgePurchaseManager extends ZapPurchaseManager<BadgeEntry> {
 *   constructor(eventSigner: EventSigner) {
 *     super({
 *       zapLabel: 'badge-purchase',
 *       registryEventKind: 30000,
 *       registryDTag: 'supporter-badges',
 *       pricing: BADGE_PRICING,
 *     }, eventSigner)
 *   }
 *
 *   protected extractRegistryKey(zapRequest: NostrEvent): string | null {
 *     return zapRequest.pubkey // Badge is keyed by pubkey
 *   }
 *
 *   protected validateRegistration(key: string, pubkey: string): string | null {
 *     return null // No special validation needed
 *   }
 *
 *   // ... other implementable abstract methods
 * }
 */
export abstract class ZapPurchaseManager<TEntry extends ZapPurchaseEntry> {
	protected registry: Map<string, TEntry> = new Map()
	private processedReceipts: Set<string> = new Set()
	protected eventSigner: EventSigner
	protected ndk: NDK | null = null
	protected appPubkey: string = ''
	public readonly config: ZapPurchaseConfig

	constructor(config: ZapPurchaseConfig, eventSigner: EventSigner) {
		this.config = config
		this.eventSigner = eventSigner
	}

	// --- Abstract methods implemented in subclasses ---

	/** Extract the registry key from a zap request (vanity name from tags, or pubkey for badges) */
	protected abstract extractRegistryKey(zapRequest: NostrEvent): string | null

	/** Validate whether a registration is allowed. Return null if valid, or an error message string. */
	protected abstract validateRegistration(key: string, pubkey: string): string | null

	/** Parse entries from a Nostr registry event's tags */
	protected abstract extractEntriesFromEvent(event: NostrEvent): Array<{ key: string; entry: TEntry }>

	/** Build Nostr event tags from the current registry entries */
	protected abstract buildRegistryTags(entries: Map<string, TEntry>): string[][]

	/** Create a new entry instance for the given key, pubkey, and validity timestamp */
	protected abstract createEntry(key: string, pubkey: string, validUntil: number): TEntry

	// --- Optional hooks (override in subclass) ---

	/** Called after a new entry is registered. Use for secondary indexes (e.g. pubkey→key reverse lookup). */
	protected onEntryRegistered?(key: string, entry: TEntry): void

	/** Called after the registry is fully rebuilt from an event. Use to rebuild secondary indexes. */
	protected onRegistryRebuilt?(): void

	// --- Public API ---

	public setNDK(ndk: NDK): void {
		this.ndk = ndk
	}

	public setAppPubkey(pubkey: string): void {
		this.appPubkey = pubkey
	}

	/**
	 * Handle a registry event (rebuild in-memory state from a Nostr event).
	 * Called when a registry kind(kind 30000)) event is received.
	 */
	public async handleRegistryEvent(event: NostrEvent): Promise<void> {
		console.log(`[${this.config.registryDTag}] Processing registry event: ${event.id}`)

		const entries = this.extractEntriesFromEvent(event)

		this.registry.clear()
		const now = Math.floor(Date.now() / 1000)

		for (const { key, entry } of entries) {
			if (entry.validUntil >= now) {
				this.registry.set(key, entry)
			}
		}

		this.onRegistryRebuilt?.()
		console.log(`[${this.config.registryDTag}] Registry updated: ${this.registry.size} active entries`)
	}

	/**
	 * Handle a zap receipt (kind 9735) and register the purchase if valid.
	 * Validates - duplicity, recency, label tag, payment amount, and domain-specific rules.
	 * On success, creates/extends the registry entry and publishes the updated registry.
	 */
	public async handleZapReceipt(event: NostrEvent): Promise<void> {
		const eventId = event.id
		if (!eventId) return
		if (this.processedReceipts.has(eventId)) return
		this.processedReceipts.add(eventId)

		// Bound the dedup set to prevent unbounded memory growth
		if (this.processedReceipts.size > 2000) {
			this.processedReceipts.clear()
			this.processedReceipts.add(eventId)
		}

		// Skip old receipts (prevents re-processing on server restart)
		const maxAge = this.config.maxReceiptAge ?? 300
		const eventAge = Math.floor(Date.now() / 1000) - (event.created_at || 0)
		if (eventAge > maxAge) {
			console.log(`[${this.config.registryDTag}] Skipping old zap receipt (${eventAge}s old): ${eventId}`)
			return
		}

		// Parse zap request from the receipt's description tag
		const zapRequestTag = event.tags.find((t) => t[0] === 'description')
		if (!zapRequestTag?.[1]) return

		let zapRequest: NostrEvent
		try {
			zapRequest = JSON.parse(zapRequestTag[1])
		} catch {
			console.error(`[${this.config.registryDTag}] Failed to parse zap request from receipt`)
			return
		}

		// Check for matching purchase label
		const labelTag = zapRequest.tags.find((t) => t[0] === 'L' && t[1] === this.config.zapLabel)
		if (!labelTag) return // Not for this purchase type

		console.log(`[${this.config.registryDTag}] Processing purchase zap receipt: ${eventId}`)

		// Extract registry key from the zap request
		const key = this.extractRegistryKey(zapRequest)
		if (!key) {
			console.error(`[${this.config.registryDTag}] No registry key found in zap request`)
			return
		}

		const requesterPubkey = zapRequest.pubkey

		// Domain-specific validation
		const validationError = this.validateRegistration(key, requesterPubkey)
		if (validationError) {
			console.error(`[${this.config.registryDTag}] Validation failed: ${validationError}`)
			return
		}

		// Verify bolt11 invoice exists in receipt
		const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11')
		if (!bolt11Tag) {
			console.error(`[${this.config.registryDTag}] No bolt11 found in zap receipt`)
			return
		}

		// Extract payment amount and match to pricing tier
		const amountTag = zapRequest.tags.find((t) => t[0] === 'amount')
		const amountMsats = amountTag ? parseInt(amountTag[1]) : 0
		const amountSats = Math.floor(amountMsats / 1000)
		console.log(`[${this.config.registryDTag}] Zap amount: ${amountSats} sats`)

		const validitySeconds = this.matchPricingTier(amountSats)
		if (validitySeconds === null) {
			console.error(`[${this.config.registryDTag}] Insufficient amount: ${amountSats} sats`)
			return
		}

		// Calculate validity, extending if same owner renews
		const now = Math.floor(Date.now() / 1000)
		let validUntil = now + validitySeconds

		const existing = this.registry.get(key)
		if (existing && existing.pubkey === requesterPubkey && existing.validUntil > now) {
			validUntil = existing.validUntil + validitySeconds
		}

		console.log(`[${this.config.registryDTag}] Registration valid until: ${new Date(validUntil * 1000).toISOString()}`)

		// Create and store the entry
		const entry = this.createEntry(key, requesterPubkey, validUntil)
		this.registry.set(key, entry)
		this.onEntryRegistered?.(key, entry)

		// Publish updated registry to relays
		await this.publishRegistry()

		console.log(
			`[${this.config.registryDTag}] Registered: ${key} -> ${requesterPubkey} (valid until ${new Date(validUntil * 1000).toISOString()})`,
		)
	}

	/**
	 * Load existing registry state from the relay on startup.
	 */
	public async loadExistingRegistry(appPubkey: string): Promise<void> {
		if (!this.ndk) {
			console.warn(`[${this.config.registryDTag}] NDK not available, cannot load existing registry`)
			return
		}

		this.appPubkey = appPubkey

		try {
			const events = await this.ndk.fetchEvents({
				kinds: [this.config.registryEventKind],
				authors: [appPubkey],
				'#d': [this.config.registryDTag],
				limit: 1,
			})

			if (events.size > 0) {
				const latestEvent = Array.from(events)[0]
				await this.handleRegistryEvent(latestEvent.rawEvent())
				console.log(`[${this.config.registryDTag}] Loaded existing registry`)
			} else {
				console.log(`[${this.config.registryDTag}] No existing registry found`)
			}
		} catch (error) {
			console.error(`[${this.config.registryDTag}] Error loading existing registry:`, error)
		}
	}

	/**
	 * Get all active (non-expired) entries.
	 */
	public getAllEntries(): TEntry[] {
		const now = Math.floor(Date.now() / 1000)
		return Array.from(this.registry.values()).filter((e) => e.validUntil > now)
	}

	/**
	 * Get an entry by registry key, or null if not found or expired.
	 */
	public getEntry(key: string): TEntry | null {
		const entry = this.registry.get(key)
		if (!entry) return null
		if (entry.validUntil < Math.floor(Date.now() / 1000)) return null
		return entry
	}

	/**
	 * Find the first active entry for a given pubkey.
	 */
	public getEntryForPubkey(pubkey: string): TEntry | null {
		const now = Math.floor(Date.now() / 1000)
		for (const entry of Array.from(this.registry.values())) {
			if (entry.pubkey === pubkey && entry.validUntil > now) {
				return entry
			}
		}
		return null
	}

	// --- Protected helpers ---

	/**
	 * Comment included in the LNURL callback when generating an invoice.
	 * Override for domain-specific comments (e.g. "Vanity URL: my-shop").
	 */
	protected getInvoiceComment(registryKey: string): string {
		return `${this.config.zapLabel}: ${registryKey}`
	}

	// --- Invoice generation (server-side LNURL proxy) ---

	/**
	 * Validate a zap request and generate a Lightning invoice via LNURL-pay.
	 *
	 * This runs server-side to avoid CORS issues when the browser needs to resolve
	 * a Lightning address and obtain a BOLT11 invoice. It validates the zap request
	 * against this manager's config (correct label, amount, registry key) and runs
	 * domain-specific validation before proxying the LNURL-pay flow.
	 *
	 * @param request - The invoice request containing amount, registry key, and signed zap request
	 * @param appPubkey - The app's public key (zap request must target this)
	 * @param lightningIdentifier - The app's Lightning address (lud16) or LNURL (lud06)
	 * @param toLnurlpEndpoint - Resolves a Lightning identifier to an LNURL-pay endpoint URL
	 */
	public async generateInvoice(
		request: ZapPurchaseInvoiceRequestBody,
		appPubkey: string,
		lightningIdentifier: string,
		toLnurlpEndpoint: LnurlResolver,
	): Promise<ZapInvoiceResult> {
		const { amountSats, registryKey, zapRequest } = request

		// --- Validate request basics ---
		if (!Number.isFinite(amountSats) || amountSats <= 0) {
			throw new ZapInvoiceError('amountSats must be a positive number', 400)
		}
		if (!registryKey) {
			throw new ZapInvoiceError('registryKey is required', 400)
		}
		if (!zapRequest || !Array.isArray(zapRequest.tags)) {
			throw new ZapInvoiceError('zapRequest is required', 400)
		}
		if (!zapRequest.sig) {
			throw new ZapInvoiceError('zapRequest must be signed', 400)
		}

		// --- Validate zap request tags ---
		const hasTag = (k: string, v?: string) => zapRequest.tags.some((t) => t[0] === k && (v === undefined ? true : t[1] === v))

		if (!hasTag('L', this.config.zapLabel)) {
			throw new ZapInvoiceError(`zapRequest missing ["L","${this.config.zapLabel}"] tag`, 400)
		}
		if (!hasTag('p', appPubkey)) {
			throw new ZapInvoiceError('zapRequest must target app pubkey', 400)
		}

		// Validate registry key from zap request matches the declared key
		const extractedKey = this.extractRegistryKey(zapRequest as unknown as NostrEvent)
		if (extractedKey !== registryKey) {
			throw new ZapInvoiceError('zapRequest registry key must match registryKey', 400)
		}

		// Validate amount tag consistency
		const amountMsatsTag = zapRequest.tags.find((t) => t[0] === 'amount')?.[1]
		const amountMsats = amountMsatsTag ? Number(amountMsatsTag) : NaN
		if (!Number.isFinite(amountMsats) || amountMsats !== amountSats * 1000) {
			throw new ZapInvoiceError('zapRequest amount must match amountSats', 400)
		}

		// --- Domain-specific validation ---
		const validationError = this.validateRegistration(registryKey, zapRequest.pubkey)
		if (validationError) {
			throw new ZapInvoiceError(validationError, 400)
		}

		// --- Resolve LNURL-pay endpoint ---
		const lnurlEndpoint = toLnurlpEndpoint(lightningIdentifier)

		const lnurlRes = await fetch(lnurlEndpoint, { headers: { accept: 'application/json' } })
		if (!lnurlRes.ok) {
			throw new ZapInvoiceError(`Failed to fetch LNURL-pay data (${lnurlRes.status})`, 502)
		}

		const lnurlData = (await lnurlRes.json()) as LnurlPayData

		if (lnurlData.status === 'ERROR') {
			throw new ZapInvoiceError(lnurlData.reason || 'LNURL-pay error', 502)
		}
		if (!lnurlData.callback) {
			throw new ZapInvoiceError('LNURL-pay callback missing', 502)
		}
		if (!lnurlData.allowsNostr) {
			throw new ZapInvoiceError('App Lightning address does not support Nostr zaps (allowsNostr=false)', 400)
		}

		// --- Validate amount bounds ---
		const amountMsatsToSend = amountSats * 1000
		if (typeof lnurlData.minSendable === 'number' && amountMsatsToSend < lnurlData.minSendable) {
			throw new ZapInvoiceError(`Amount below minimum (${Math.ceil(lnurlData.minSendable / 1000)} sats)`, 400)
		}
		if (typeof lnurlData.maxSendable === 'number' && amountMsatsToSend > lnurlData.maxSendable) {
			throw new ZapInvoiceError(`Amount above maximum (${Math.floor(lnurlData.maxSendable / 1000)} sats)`, 400)
		}

		// --- Request invoice from LNURL callback ---
		const callbackUrl = new URL(lnurlData.callback)
		callbackUrl.searchParams.set('amount', amountMsatsToSend.toString())
		callbackUrl.searchParams.set('nostr', JSON.stringify(zapRequest))
		if (lnurlData.commentAllowed && lnurlData.commentAllowed > 0) {
			callbackUrl.searchParams.set('comment', this.getInvoiceComment(registryKey))
		}

		const invoiceRes = await fetch(callbackUrl.toString(), { headers: { accept: 'application/json' } })
		if (!invoiceRes.ok) {
			throw new ZapInvoiceError(`Failed to fetch invoice (${invoiceRes.status})`, 502)
		}

		const invoiceData = (await invoiceRes.json()) as LnurlInvoiceData
		if (invoiceData.status === 'ERROR') {
			throw new ZapInvoiceError(invoiceData.reason || 'Invoice error', 502)
		}
		if (!invoiceData.pr) {
			throw new ZapInvoiceError('Invoice missing pr', 502)
		}

		return { pr: invoiceData.pr }
	}

	/**
	 * Match a payment amount to the best (highest) qualifying pricing tier.
	 * Returns validity in seconds, or null if no tier matches.
	 *
	 * Tiers are sorted by sats descending so the highest qualifying tier wins.
	 * Tiers with `seconds` (dev/test tiers) use that value directly;
	 * tiers with `days` are converted to seconds.
	 */
	protected matchPricingTier(amountSats: number): number | null {
		const entries = Object.entries(this.config.pricing)
		// Sort descending by sats so we match the highest qualifying tier first
		entries.sort(([, a], [, b]) => b.sats - a.sats)

		for (const [, tier] of entries) {
			if (amountSats >= tier.sats) {
				if (tier.seconds !== undefined) {
					return tier.seconds
				}
				return tier.days * 24 * 60 * 60
			}
		}

		return null
	}

	/**
	 * Publish the current registry as a signed Nostr event to connected relays.
	 */
	protected async publishRegistry(): Promise<void> {
		if (!this.ndk) {
			console.error(`[${this.config.registryDTag}] NDK not available, cannot publish registry`)
			return
		}

		const event = new NDKEvent(this.ndk)
		event.kind = this.config.registryEventKind
		event.content = ''
		event.created_at = Math.floor(Date.now() / 1000)

		const tags: string[][] = [['d', this.config.registryDTag]]
		tags.push(...this.buildRegistryTags(this.registry))
		event.tags = tags

		try {
			const signedEvent = this.eventSigner.signEvent(event.rawEvent())
			if (signedEvent) {
				const ndkEvent = new NDKEvent(this.ndk, signedEvent)
				await ndkEvent.publish()
				console.log(`[${this.config.registryDTag}] Registry published: ${signedEvent.id}`)
			}
		} catch (error) {
			console.error(`[${this.config.registryDTag}] Failed to publish registry:`, error)
		}
	}
}

/**
 * Error thrown during invoice generation with an HTTP status code.
 * The generic route handler uses `status` to set the response code.
 */
export class ZapInvoiceError extends Error {
	public readonly status: number
	constructor(message: string, status: number) {
		super(message)
		this.name = 'ZapInvoiceError'
		this.status = status
	}
}
