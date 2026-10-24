import type { NostrEvent } from '@nostr-dev-kit/ndk'
import { ZapPurchaseManager, type PricingTier, type ZapPurchaseEntry } from './ZapPurchaseManager'
import type { EventSigner } from './EventSigner'

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
	'root',
	'postmaster',
	'webmaster',
	'hostmaster',
	'abuse',
	'noc',
	'security',
	'info',
	'noreply',
	'no-reply',
	'system',
	'bot',
])

export const STOREFRONT_PRICING: Record<string, PricingTier> = {
	...(process.env.NODE_ENV === 'development' ? { dev: { sats: 10, days: 0, seconds: 90, label: '90 Seconds (Dev)' } } : {}),
	'6mo': { sats: 10000, days: 180, label: '6 Months' },
	'1yr': { sats: 18000, days: 365, label: '1 Year' },
}

export interface StorefrontIdentityEntry extends ZapPurchaseEntry {
	name: string
}

export class StorefrontIdentityManager extends ZapPurchaseManager<StorefrontIdentityEntry> {
	private pubkeyToName = new Map<string, string>()

	constructor(eventSigner: EventSigner) {
		super(
			{
				zapLabel: 'storefront-register',
				registryEventKind: 30000,
				registryDTag: 'storefront-names',
				pricing: STOREFRONT_PRICING,
			},
			eventSigner,
		)
	}

	protected extractRegistryKey(zapRequest: NostrEvent): string | null {
		return zapRequest.tags.find((tag) => tag[0] === 'name')?.[1]?.toLowerCase() ?? null
	}

	protected validateRegistration(name: string, pubkey: string): string | null {
		if (!/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(name)) return `Invalid storefront name: ${name}`
		if (RESERVED_NAMES.has(name)) return `Reserved storefront name: ${name}`

		const existing = this.registry.get(name)
		if (existing && existing.pubkey !== pubkey && existing.validUntil > Math.floor(Date.now() / 1000)) {
			return `Storefront name already taken: ${name}`
		}
		return null
	}

	protected extractEntriesFromEvent(event: NostrEvent): Array<{ key: string; entry: StorefrontIdentityEntry }> {
		return event.tags
			.filter((tag) => tag[0] === 'name' && tag[1] && tag[2] && tag[3])
			.map((tag) => ({
				key: tag[1].toLowerCase(),
				entry: { name: tag[1].toLowerCase(), pubkey: tag[2], validUntil: Number.parseInt(tag[3], 10) || 0 },
			}))
	}

	protected buildRegistryTags(entries: Map<string, StorefrontIdentityEntry>): string[][] {
		return Array.from(entries.values()).map((entry) => ['name', entry.name, entry.pubkey, entry.validUntil.toString()])
	}

	protected createEntry(name: string, pubkey: string, validUntil: number): StorefrontIdentityEntry {
		return { name, pubkey, validUntil }
	}

	protected getInvoiceComment(name: string): string {
		return `Storefront name: ${name}`
	}

	protected onEntryRegistered(_key: string, entry: StorefrontIdentityEntry): void {
		this.pubkeyToName.set(entry.pubkey, entry.name)
	}

	protected onRegistryRebuilt(): void {
		this.pubkeyToName.clear()
		for (const entry of this.registry.values()) this.pubkeyToName.set(entry.pubkey, entry.name)
	}

	public resolveName(name: string): StorefrontIdentityEntry | null {
		return this.getEntry(name.toLowerCase())
	}

	public getNameForPubkey(pubkey: string): StorefrontIdentityEntry | null {
		const name = this.pubkeyToName.get(pubkey)
		return name ? this.resolveName(name) : null
	}

	public buildNostrJson(requestedName?: string): { names: Record<string, string> } {
		const names: Record<string, string> = {}
		const entries = requestedName ? [this.resolveName(requestedName)] : this.getAllEntries()
		for (const entry of entries) {
			if (entry) names[entry.name] = entry.pubkey
		}
		return { names }
	}

	public isNameAvailable(name: string): boolean {
		const normalized = name.toLowerCase()
		if (RESERVED_NAMES.has(normalized) || !/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(normalized)) return false
		const existing = this.registry.get(normalized)
		return !existing || existing.validUntil < Math.floor(Date.now() / 1000)
	}

	public async loadExistingStorefrontRegistry(appPubkey: string): Promise<void> {
		return this.loadExistingRegistry(appPubkey)
	}
}
