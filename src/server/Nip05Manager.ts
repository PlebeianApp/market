import type { NostrEvent } from '@nostr-dev-kit/ndk'
import { ZapPurchaseManager, type PricingTier, type ZapPurchaseEntry } from './ZapPurchaseManager'
import type { EventSigner } from './EventSigner'

// Reserved NIP-05 names that cannot be registered
const RESERVED_NAMES = new Set([
	'admin',
	'_',
	'root',
	'postmaster',
	'webmaster',
	'hostmaster',
	'abuse',
	'noc',
	'security',
	'info',
	'support',
	'help',
	'noreply',
	'no-reply',
	'app',
	'system',
	'api',
	'bot',
])

// Pricing tiers: amount in sats -> validity in days (or seconds for dev)
export const NIP05_PRICING: Record<string, PricingTier> = {
	...(process.env.NODE_ENV === 'development'
		? {
				dev: { sats: 10, days: 0, seconds: 90, label: '90 Seconds (Dev)' },
			}
		: {}),
	'6mo': { sats: 10000, days: 180, label: '6 Months' },
	'1yr': { sats: 18000, days: 365, label: '1 Year' },
}

export interface Nip05Entry extends ZapPurchaseEntry {
	username: string
}

export class Nip05ManagerImpl extends ZapPurchaseManager<Nip05Entry> {
	private pubkeyToUsername: Map<string, string> = new Map() // Reverse lookup

	constructor(eventSigner: EventSigner) {
		super(
			{
				zapLabel: 'nip05-register',
				registryEventKind: 30000,
				registryDTag: 'nip05-names',
				pricing: NIP05_PRICING,
			},
			eventSigner,
		)
	}

	// --- ZapPurchaseManager abstract implementations ---

	protected extractRegistryKey(zapRequest: NostrEvent): string | null {
		const tag = zapRequest.tags.find((t) => t[0] === 'nip05')
		return tag?.[1]?.toLowerCase() ?? null
	}

	protected validateRegistration(key: string, pubkey: string): string | null {
		if (!this.isValidUsername(key)) {
			return `Invalid NIP-05 username: ${key}`
		}
		if (this.isReservedName(key)) {
			return `Reserved NIP-05 username: ${key}`
		}
		const existing = this.registry.get(key)
		if (existing && existing.pubkey !== pubkey && existing.validUntil > Math.floor(Date.now() / 1000)) {
			return `NIP-05 username already taken: ${key}`
		}
		return null
	}

	protected extractEntriesFromEvent(event: NostrEvent): Array<{ key: string; entry: Nip05Entry }> {
		return event.tags
			.filter((tag) => tag[0] === 'nip05' && tag[1] && tag[2] && tag[3])
			.map((tag) => ({
				key: tag[1].toLowerCase(),
				entry: {
					username: tag[1].toLowerCase(),
					pubkey: tag[2],
					validUntil: parseInt(tag[3]) || 0,
				},
			}))
	}

	protected buildRegistryTags(entries: Map<string, Nip05Entry>): string[][] {
		return Array.from(entries.values()).map((entry) => ['nip05', entry.username, entry.pubkey, entry.validUntil.toString()])
	}

	protected createEntry(key: string, pubkey: string, validUntil: number): Nip05Entry {
		return { username: key, pubkey, validUntil }
	}

	protected getInvoiceComment(registryKey: string): string {
		return `NIP-05 Address: ${registryKey}`
	}

	protected onEntryRegistered(key: string, entry: Nip05Entry): void {
		this.pubkeyToUsername.set(entry.pubkey, key)
	}

	protected onRegistryRebuilt(): void {
		this.pubkeyToUsername.clear()
		for (const [key, entry] of Array.from(this.registry.entries())) {
			this.pubkeyToUsername.set(entry.pubkey, key)
		}
	}

	// --- NIP-05-specific public API ---

	/**
	 * Build the NIP-05 nostr.json response from active entries.
	 * Returns { names: { username: pubkey } } for all active registrations.
	 */
	public buildNostrJson(requestedName?: string): { names: Record<string, string> } {
		const now = Math.floor(Date.now() / 1000)
		const names: Record<string, string> = {}

		if (requestedName) {
			const entry = this.registry.get(requestedName.toLowerCase())
			if (entry && entry.validUntil > now) {
				names[entry.username] = entry.pubkey
			}
		} else {
			for (const [, entry] of Array.from(this.registry.entries())) {
				if (entry.validUntil > now) {
					names[entry.username] = entry.pubkey
				}
			}
		}

		return { names }
	}

	public resolveUsername(username: string): Nip05Entry | null {
		return this.getEntry(username.toLowerCase())
	}

	public isUsernameAvailable(username: string): boolean {
		if (this.isReservedName(username)) return false
		if (!this.isValidUsername(username)) return false

		const entry = this.registry.get(username.toLowerCase())
		if (!entry) return true

		// Available if expired
		return entry.validUntil < Math.floor(Date.now() / 1000)
	}

	public isReservedName(username: string): boolean {
		return RESERVED_NAMES.has(username.toLowerCase())
	}

	public getUsernameForPubkey(pubkey: string): Nip05Entry | null {
		const username = this.pubkeyToUsername.get(pubkey)
		if (!username) return null
		return this.resolveUsername(username)
	}

	public getAllNip05Entries(): Nip05Entry[] {
		return this.getAllEntries()
	}

	public async loadExistingNip05Registry(appPubkey: string): Promise<void> {
		return this.loadExistingRegistry(appPubkey)
	}

	private isValidUsername(name: string): boolean {
		// Allow alphanumeric, hyphens, underscores, dots, 1-30 characters
		const regex = /^[a-z0-9][a-z0-9._-]{0,28}[a-z0-9]$|^[a-z0-9]$/
		return regex.test(name.toLowerCase())
	}
}
