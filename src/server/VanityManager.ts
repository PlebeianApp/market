import type { NostrEvent } from '@nostr-dev-kit/ndk'
import NDK, { NDKEvent, type NDKSigner } from '@nostr-dev-kit/ndk'
import type { EventSigner } from './EventSigner'
import type { NDKService } from './NDKService'

// Reserved vanity names that cannot be registered
const RESERVED_NAMES = new Set([
	'admin',
	'api',
	'dashboard',
	'products',
	'product',
	'profile',
	'checkout',
	'setup',
	'community',
	'posts',
	'post',
	'nostr',
	'search',
	'collection',
	'collections',
	'settings',
	'support',
	'help',
	'about',
	'terms',
	'privacy',
	'login',
	'logout',
	'register',
	'signup',
	'signin',
	'account',
	'user',
	'users',
	'app',
	'static',
	'assets',
	'images',
	'public',
	'favicon',
	'robots',
	'sitemap',
])

// Pricing tiers: amount in sats -> validity in days (or seconds for dev)
export const VANITY_PRICING: Record<string, { sats: number; days: number; seconds?: number; label: string }> = {
	...(process.env.NODE_ENV === 'development'
		? {
				dev: { sats: 10, days: 0, seconds: 90, label: '90 Seconds (Dev)' },
			}
		: {}),
	'6mo': { sats: 10000, days: 180, label: '6 Months' },
	'1yr': { sats: 18000, days: 365, label: '1 Year' },
}

export interface VanityEntry {
	vanityName: string
	pubkey: string
	validUntil: number // Unix timestamp
}

export interface VanityManager {
	handleVanityEvent(event: NostrEvent): Promise<void>
	handleZapReceipt(event: NostrEvent): Promise<void>
	registerVanityPurchase(vanityName: string, requesterPubkey: string, amountSats: number): Promise<number | null>
	resolveVanity(vanityName: string): VanityEntry | null
	isVanityAvailable(vanityName: string): boolean
	isReservedName(vanityName: string): boolean
	getVanityForPubkey(pubkey: string): VanityEntry | null
	getAllVanityEntries(): VanityEntry[]
}

export class VanityManagerImpl implements VanityManager {
	private vanityRegistry: Map<string, VanityEntry> = new Map()
	private pubkeyToVanity: Map<string, string> = new Map() // Reverse lookup
	private eventSigner: EventSigner
	private ndkService: NDKService
	private ndk: NDK | null = null
	private appPubkey: string = ''
	private lastRegistryUpdatedAt: number = 0
	private processedBolt11: Map<string, number> = new Map()

	constructor(eventSigner: EventSigner, ndkService: NDKService) {
		this.eventSigner = eventSigner
		this.ndkService = ndkService
	}

	public setNDK(ndk: NDK): void {
		this.ndk = ndk
	}

	public setAppPubkey(pubkey: string): void {
		this.appPubkey = pubkey
	}

	/**
	 * Handle vanity registry event (kind 30000 with d=vanity-urls)
	 */
	public async handleVanityEvent(event: NostrEvent): Promise<void> {
		console.log('Processing vanity registry event:', event.id)
		this.lastRegistryUpdatedAt = event.created_at ?? this.lastRegistryUpdatedAt

		// Extract vanity entries from event tags
		const entries = this.extractVanityEntries(event)

		const now = Math.floor(Date.now() / 1000)
		const bestByPubkey = new Map<string, VanityEntry>()

		for (const entry of entries) {
			// Skip expired entries
			if (entry.validUntil < now) {
				continue
			}

			const normalizedName = entry.vanityName.toLowerCase()
			const existingForPubkey = bestByPubkey.get(entry.pubkey)

			// If multiple entries exist for a pubkey, keep the one with the latest validity.
			if (!existingForPubkey || entry.validUntil > existingForPubkey.validUntil) {
				bestByPubkey.set(entry.pubkey, { ...entry, vanityName: normalizedName })
			}
		}

		// Clear and rebuild registry with one entry per pubkey
		this.vanityRegistry.clear()
		this.pubkeyToVanity.clear()

		for (const entry of bestByPubkey.values()) {
			this.vanityRegistry.set(entry.vanityName, entry)
			this.pubkeyToVanity.set(entry.pubkey, entry.vanityName)
		}

		console.log(`Vanity registry updated: ${this.vanityRegistry.size} active entries`)
	}

	/**
	 * Handle zap receipt and register vanity URL if valid
	 */
	public async handleZapReceipt(event: NostrEvent): Promise<void> {
		// Avoid re-processing historical receipts already reflected in the latest registry event.
		// This also prevents accidental validity extension during server restarts / Bun HMR reloads.
		if ((event.created_at ?? 0) <= this.lastRegistryUpdatedAt) {
			return
		}

		// Parse zap request from the receipt
		const zapRequestTag = event.tags.find((t) => t[0] === 'description')
		if (!zapRequestTag || !zapRequestTag[1]) {
			return
		}

		let zapRequest: NostrEvent
		try {
			zapRequest = JSON.parse(zapRequestTag[1])
		} catch {
			console.error('Failed to parse zap request from receipt')
			return
		}

		// Check for vanity-register label
		const labelTag = zapRequest.tags.find((t) => t[0] === 'L' && t[1] === 'vanity-register')
		if (!labelTag) {
			return // Not a vanity registration zap
		}

		console.log(`Received vanity registration zap receipt: ${event.id}`)
		console.log('Processing vanity registration zap:', event.id)

		// Extract vanity name from zap request content or tags
		const vanityTag = zapRequest.tags.find((t) => t[0] === 'vanity')
		if (!vanityTag || !vanityTag[1]) {
			console.error('No vanity name found in zap request')
			return
		}

		const vanityName = vanityTag[1].toLowerCase()
		const requesterPubkey = zapRequest.pubkey
		console.log(`Zap requests vanity name: ${vanityName} for pubkey: ${requesterPubkey}`)

		// Validate vanity name
		if (!this.isValidVanityName(vanityName)) {
			console.error(`Invalid vanity name: ${vanityName}`)
			return
		}

		if (this.isReservedName(vanityName)) {
			console.error(`Reserved vanity name: ${vanityName}`)
			return
		}

		// Check if already taken by someone else
		const existing = this.vanityRegistry.get(vanityName)
		if (existing && existing.pubkey !== requesterPubkey && existing.validUntil > Math.floor(Date.now() / 1000)) {
			console.error(`Vanity name already taken: ${vanityName}`)
			return
		}

		// Get amount from bolt11 tag
		const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11')
		if (!bolt11Tag) {
			console.error('No bolt11 found in zap receipt')
			return
		}
		const bolt11 = bolt11Tag[1]
		if (bolt11) {
			// Many clients/LSPs can publish multiple zap receipts for the same payment.
			// Deduplicate by bolt11 so we don't extend/publish repeatedly.
			const nowMs = Date.now()
			const prev = this.processedBolt11.get(bolt11)
			if (prev && nowMs - prev < 1000 * 60 * 60) {
				return
			}
			this.processedBolt11.set(bolt11, nowMs)
			// Simple TTL cleanup to avoid unbounded growth
			if (this.processedBolt11.size > 2000) {
				for (const [key, ts] of this.processedBolt11.entries()) {
					if (nowMs - ts > 1000 * 60 * 60) this.processedBolt11.delete(key)
				}
			}
		}

		// Calculate validity based on amount
		const amountTag = zapRequest.tags.find((t) => t[0] === 'amount')
		const amountMsats = amountTag ? parseInt(amountTag[1]) : 0
		const amountSats = Math.floor(amountMsats / 1000)
		console.log(`Zap amount: ${amountSats} sats`)

		await this.registerVanityPurchase(vanityName, requesterPubkey, amountSats)
	}

	public async registerVanityPurchase(vanityName: string, requesterPubkey: string, amountSats: number): Promise<number | null> {
		const normalizedName = vanityName.toLowerCase()

		// Validate vanity name
		if (!this.isValidVanityName(normalizedName)) {
			console.error(`Invalid vanity name: ${normalizedName}`)
			return null
		}

		if (this.isReservedName(normalizedName)) {
			console.error(`Reserved vanity name: ${normalizedName}`)
			return null
		}

		// Check if already taken by someone else
		const existing = this.vanityRegistry.get(normalizedName)
		const now = Math.floor(Date.now() / 1000)
		if (existing && existing.pubkey !== requesterPubkey && existing.validUntil > now) {
			console.error(`Vanity name already taken: ${normalizedName}`)
			return null
		}

		console.log(`Processing vanity purchase: ${normalizedName} for pubkey: ${requesterPubkey} (${amountSats} sats)`)

		let validitySeconds = 0

		// Check dev tier first (only in development)
		if (VANITY_PRICING['dev'] && amountSats >= VANITY_PRICING['dev'].sats) {
			validitySeconds = VANITY_PRICING['dev'].seconds || 30
		}
		// Check 1 year tier
		if (amountSats >= VANITY_PRICING['1yr'].sats) {
			validitySeconds = VANITY_PRICING['1yr'].days * 24 * 60 * 60
		} else if (amountSats >= VANITY_PRICING['6mo'].sats) {
			validitySeconds = VANITY_PRICING['6mo'].days * 24 * 60 * 60
		} else if (!validitySeconds) {
			console.error(`Insufficient amount for vanity registration: ${amountSats} sats`)
			return null
		}

		// Calculate valid until timestamp
		let validUntil = now + validitySeconds

		// If extending existing registration, add to current validity
		if (existing && existing.pubkey === requesterPubkey && existing.validUntil > now) {
			validUntil = existing.validUntil + validitySeconds
		}

		console.log(`Registration valid until: ${new Date(validUntil * 1000).toISOString()}`)

		// Update registry
		const newEntry: VanityEntry = {
			vanityName: normalizedName,
			pubkey: requesterPubkey,
			validUntil,
		}

		// Update in-memory registry
		// Enforce a single active vanity per pubkey by removing any previous mapping(s) for this pubkey.
		for (const [key, entry] of this.vanityRegistry.entries()) {
			if (entry.pubkey === requesterPubkey && key !== normalizedName) {
				this.vanityRegistry.delete(key)
			}
		}
		this.vanityRegistry.set(normalizedName, newEntry)
		this.pubkeyToVanity.set(requesterPubkey, normalizedName)

		// Publish updated registry event
		await this.publishVanityRegistry()

		console.log(
			`Vanity URL registered successfully: ${normalizedName} -> ${requesterPubkey} (valid until ${new Date(validUntil * 1000).toISOString()})`,
		)
		return validUntil
	}

	/**
	 * Publish the current vanity registry as a kind 30000 event
	 */
	private async publishVanityRegistry(): Promise<void> {
		if (!this.ndk) {
			console.error('NDK not available, cannot publish vanity registry')
			return
		}

		const event = new NDKEvent(this.ndk)
		event.kind = 30000
		event.content = ''
		event.created_at = Math.floor(Date.now() / 1000)

		// Build tags
		const tags: string[][] = [['d', 'vanity-urls']]

		for (const entry of Array.from(this.vanityRegistry.values())) {
			tags.push(['vanity', entry.vanityName, entry.pubkey, entry.validUntil.toString()])
		}

		event.tags = tags

		try {
			// Sign with app private key
			const signedEvent = this.eventSigner.signEvent(event.rawEvent())
			if (signedEvent) {
				const ndkEvent = new NDKEvent(this.ndk, signedEvent)
				await ndkEvent.publish()
				console.log('Vanity registry published:', signedEvent.id)
				this.lastRegistryUpdatedAt = signedEvent.created_at ?? this.lastRegistryUpdatedAt
			}
		} catch (error) {
			console.error('Failed to publish vanity registry:', error)
		}
	}

	private extractVanityEntries(event: NostrEvent): VanityEntry[] {
		return event.tags
			.filter((tag) => tag[0] === 'vanity' && tag[1] && tag[2] && tag[3])
			.map((tag) => ({
				vanityName: tag[1].toLowerCase(),
				pubkey: tag[2],
				validUntil: parseInt(tag[3]) || 0,
			}))
	}

	private isValidVanityName(name: string): boolean {
		// Allow alphanumeric, hyphens, underscores, 3-30 characters
		const regex = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/
		return regex.test(name.toLowerCase())
	}

	public isReservedName(vanityName: string): boolean {
		return RESERVED_NAMES.has(vanityName.toLowerCase())
	}

	public resolveVanity(vanityName: string): VanityEntry | null {
		const entry = this.vanityRegistry.get(vanityName.toLowerCase())
		if (!entry) return null

		// Check if expired
		if (entry.validUntil < Math.floor(Date.now() / 1000)) {
			return null
		}

		return entry
	}

	public isVanityAvailable(vanityName: string): boolean {
		if (this.isReservedName(vanityName)) return false
		if (!this.isValidVanityName(vanityName)) return false

		const entry = this.vanityRegistry.get(vanityName.toLowerCase())
		if (!entry) return true

		// Available if expired
		return entry.validUntil < Math.floor(Date.now() / 1000)
	}

	public getVanityForPubkey(pubkey: string): VanityEntry | null {
		const vanityName = this.pubkeyToVanity.get(pubkey)
		if (!vanityName) return null

		return this.resolveVanity(vanityName)
	}

	public getAllVanityEntries(): VanityEntry[] {
		const now = Math.floor(Date.now() / 1000)
		return Array.from(this.vanityRegistry.values()).filter((entry) => entry.validUntil > now)
	}

	public async loadExistingVanityRegistry(appPubkey: string): Promise<void> {
		if (!this.ndk) {
			console.warn('NDK not available, cannot load existing vanity registry')
			return
		}

		this.appPubkey = appPubkey

		try {
			// Fetch the most recent vanity registry event
			const events = await this.ndk.fetchEvents({
				kinds: [30000],
				authors: [appPubkey],
				'#d': ['vanity-urls'],
				limit: 1,
			})

			if (events.size > 0) {
				const latestEvent = Array.from(events)[0]
				await this.handleVanityEvent(latestEvent.rawEvent())
				console.log('Loaded existing vanity registry')
			} else {
				console.log('No existing vanity registry found')
			}
		} catch (error) {
			console.error('Error loading existing vanity registry:', error)
		}
	}
}
