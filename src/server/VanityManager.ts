import type { NostrEvent } from '@nostr-dev-kit/ndk'
import { ZapPurchaseManager, type PricingTier, type ZapPurchaseEntry } from './ZapPurchaseManager'
import type { EventSigner } from './EventSigner'

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
export const VANITY_PRICING: Record<string, PricingTier> = {
	...(process.env.NODE_ENV === 'development'
		? {
				dev: { sats: 10, days: 0, seconds: 90, label: '90 Seconds (Dev)' },
			}
		: {}),
	'6mo': { sats: 10000, days: 180, label: '6 Months' },
	'1yr': { sats: 18000, days: 365, label: '1 Year' },
}

export interface VanityEntry extends ZapPurchaseEntry {
	vanityName: string
}

export class VanityManagerImpl extends ZapPurchaseManager<VanityEntry> {
	private pubkeyToVanity: Map<string, string> = new Map() // Reverse lookup

	constructor(eventSigner: EventSigner) {
		super(
			{
				zapLabel: 'vanity-register',
				registryEventKind: 30000,
				registryDTag: 'vanity-urls',
				pricing: VANITY_PRICING,
			},
			eventSigner,
		)
	}

	// --- ZapPurchaseManager abstract implementations ---

	protected extractRegistryKey(zapRequest: NostrEvent): string | null {
		const tag = zapRequest.tags.find((t) => t[0] === 'vanity')
		return tag?.[1]?.toLowerCase() ?? null
	}

	protected validateRegistration(key: string, pubkey: string): string | null {
		if (!this.isValidVanityName(key)) {
			return `Invalid vanity name: ${key}`
		}
		if (this.isReservedName(key)) {
			return `Reserved vanity name: ${key}`
		}
		const existing = this.registry.get(key)
		if (existing && existing.pubkey !== pubkey && existing.validUntil > Math.floor(Date.now() / 1000)) {
			return `Vanity name already taken: ${key}`
		}
		return null
	}

	protected extractEntriesFromEvent(event: NostrEvent): Array<{ key: string; entry: VanityEntry }> {
		return event.tags
			.filter((tag) => tag[0] === 'vanity' && tag[1] && tag[2] && tag[3])
			.map((tag) => ({
				key: tag[1].toLowerCase(),
				entry: {
					vanityName: tag[1].toLowerCase(),
					pubkey: tag[2],
					validUntil: parseInt(tag[3]) || 0,
				},
			}))
	}

	protected buildRegistryTags(entries: Map<string, VanityEntry>): string[][] {
		return Array.from(entries.values()).map((entry) => ['vanity', entry.vanityName, entry.pubkey, entry.validUntil.toString()])
	}

	protected createEntry(key: string, pubkey: string, validUntil: number): VanityEntry {
		return { vanityName: key, pubkey, validUntil }
	}

	// --- Optional hooks ---

	protected getInvoiceComment(registryKey: string): string {
		return `Vanity URL: ${registryKey}`
	}

	protected onEntryRegistered(key: string, entry: VanityEntry): void {
		this.pubkeyToVanity.set(entry.pubkey, key)
	}

	protected onRegistryRebuilt(): void {
		this.pubkeyToVanity.clear()
		for (const [key, entry] of Array.from(this.registry.entries())) {
			this.pubkeyToVanity.set(entry.pubkey, key)
		}
	}

	// --- Vanity-specific public API ---

	/**
	 * Handle vanity registry event (kind 30000 with d=vanity-urls).
	 * Convenience wrapper over base class handleRegistryEvent.
	 */
	public async handleVanityEvent(event: NostrEvent): Promise<void> {
		return this.handleRegistryEvent(event)
	}

	public resolveVanity(vanityName: string): VanityEntry | null {
		return this.getEntry(vanityName.toLowerCase())
	}

	public isVanityAvailable(vanityName: string): boolean {
		if (this.isReservedName(vanityName)) return false
		if (!this.isValidVanityName(vanityName)) return false

		const entry = this.registry.get(vanityName.toLowerCase())
		if (!entry) return true

		// Available if expired
		return entry.validUntil < Math.floor(Date.now() / 1000)
	}

	public isReservedName(vanityName: string): boolean {
		return RESERVED_NAMES.has(vanityName.toLowerCase())
	}

	public getVanityForPubkey(pubkey: string): VanityEntry | null {
		const vanityName = this.pubkeyToVanity.get(pubkey)
		if (!vanityName) return null
		return this.resolveVanity(vanityName)
	}

	public getAllVanityEntries(): VanityEntry[] {
		return this.getAllEntries()
	}

	/**
	 * Load existing vanity registry from relay.
	 * Convenience wrapper over base class loadExistingRegistry.
	 */
	public async loadExistingVanityRegistry(appPubkey: string): Promise<void> {
		return this.loadExistingRegistry(appPubkey)
	}

	private isValidVanityName(name: string): boolean {
		// Allow alphanumeric, hyphens, underscores, 3-30 characters
		const regex = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/
		return regex.test(name.toLowerCase())
	}
}
