import type { NostrEvent } from '@nostr-dev-kit/ndk'
import { ZapPurchaseManager, type PricingTier, type PurchaseValidationStage, type ZapPurchaseEntry } from './ZapPurchaseManager'
import type { EventSigner } from './EventSigner'
import { Nip05ManagerImpl, NIP05_PRICING } from './Nip05Manager'
import { VanityManagerImpl, VANITY_PRICING } from './VanityManager'

export interface StorefrontIdentityEntry extends ZapPurchaseEntry {
	name: string
}

const IDENTITY_PRICING: Record<string, PricingTier> = Object.fromEntries(
	Object.entries(VANITY_PRICING)
		.filter(([key]) => NIP05_PRICING[key])
		.flatMap(([key, tier]) => [
			[`one-${key}`, { ...tier, label: `${tier.label} (legacy identity completion)` }],
			[
				`both-${key}`,
				{
					...tier,
					sats: tier.sats + NIP05_PRICING[key].sats,
					label: `${tier.label} (NIP-05 + vanity URL)`,
				},
			],
		]),
)

export class StorefrontIdentityManager extends ZapPurchaseManager<StorefrontIdentityEntry> {
	constructor(
		eventSigner: EventSigner,
		handlerId: string,
		private readonly vanityManager: VanityManagerImpl,
		private readonly nip05Manager: Nip05ManagerImpl,
	) {
		super(
			{
				zapLabel: 'storefront-register',
				registryEventKind: 30000,
				registryDTag: `${handlerId}-storefront-names`,
				pricing: IDENTITY_PRICING,
			},
			eventSigner,
		)
	}

	protected extractRegistryKey(zapRequest: NostrEvent): string | null {
		return zapRequest.tags.find((tag) => tag[0] === 'name')?.[1]?.toLowerCase() ?? null
	}

	protected validateRegistration(name: string, pubkey: string): string | null {
		if (!this.vanityManager.isValidVanityName(name) || !this.nip05Manager.isValidUsername(name)) {
			return `Invalid storefront name: ${name}`
		}
		if (this.vanityManager.isReservedName(name) || this.nip05Manager.isReservedName(name)) {
			return `Reserved storefront name: ${name}`
		}

		const now = Math.floor(Date.now() / 1000)
		const unifiedEntry = this.registry.get(name)
		if (unifiedEntry && unifiedEntry.pubkey !== pubkey && unifiedEntry.validUntil > now) {
			return `Storefront name already taken: ${name}`
		}

		if (!unifiedEntry) {
			for (const entry of [this.vanityManager.getEntry(name), this.nip05Manager.getEntry(name)]) {
				if (entry && entry.pubkey !== pubkey && entry.validUntil > now) {
					return `Storefront name already held by another account: ${name}`
				}
			}
		}

		const existingForPubkey = this.getEntryForPubkey(pubkey)
		if (existingForPubkey && existingForPubkey.name !== name) {
			return 'This account already has a different active storefront name.'
		}

		return null
	}

	protected extractEntriesFromEvent(event: NostrEvent): Array<{ key: string; entry: StorefrontIdentityEntry }> {
		return event.tags
			.filter((tag) => tag[0] === 'name' && tag[1] && tag[2] && tag[3])
			.map((tag) => ({
				key: tag[1].toLowerCase(),
				entry: {
					name: tag[1].toLowerCase(),
					pubkey: tag[2],
					validUntil: Number.parseInt(tag[3], 10) || 0,
				},
			}))
	}

	protected buildRegistryTags(entries: Map<string, StorefrontIdentityEntry>): string[][] {
		return Array.from(entries.values()).map((entry) => ['name', entry.name, entry.pubkey, entry.validUntil.toString()])
	}

	protected createEntry(name: string, pubkey: string, validUntil: number): StorefrontIdentityEntry {
		return { name, pubkey, validUntil }
	}

	protected validatePurchaseAmount(
		amountSats: number,
		name: string,
		pubkey: string,
		zapRequest: NostrEvent,
		stage: PurchaseValidationStage,
	): string | null {
		const tierKey = zapRequest.tags.find((tag) => tag[0] === 'tier')?.[1]
		const countTag = zapRequest.tags.find((tag) => tag[0] === 'count')?.[1]
		const count = Number(countTag)
		const tier = tierKey ? VANITY_PRICING[tierKey] : undefined
		const nip05Tier = tierKey ? NIP05_PRICING[tierKey] : undefined
		if (!tier || !nip05Tier || (countTag !== '1' && countTag !== '2')) {
			return 'Storefront purchase must specify a valid tier and identity count.'
		}
		if (amountSats !== tier.sats * count) {
			return 'Storefront purchase amount does not match the selected tier.'
		}
		const requiredCount = this.getChargeCount(name, pubkey)
		if ((stage === 'invoice' && count !== requiredCount) || (stage === 'receipt' && count < requiredCount)) {
			return 'Storefront purchase amount does not match the identities being registered.'
		}
		return null
	}

	protected async applyPurchase(name: string, pubkey: string, validitySeconds: number, now: number): Promise<void> {
		const existingExpiries = [this.registry.get(name), this.vanityManager.getEntry(name), this.nip05Manager.getEntry(name)].flatMap(
			(entry) => (entry?.pubkey === pubkey ? [entry.validUntil] : []),
		)
		const validUntil = Math.max(now, ...existingExpiries) + validitySeconds
		this.registry.set(name, this.createEntry(name, pubkey, validUntil))
		await this.publishRegistry()
	}

	public getChargeCount(name: string, pubkey: string): number {
		const unifiedEntry = this.registry.get(name)
		if (unifiedEntry?.pubkey === pubkey && unifiedEntry.validUntil > Date.now() / 1000) return 2

		const legacyEntries = [this.vanityManager.getEntry(name), this.nip05Manager.getEntry(name)]
		const matchingLegacyCount = legacyEntries.filter((entry) => entry?.pubkey === pubkey).length
		return matchingLegacyCount === 1 ? 1 : 2
	}

	public getAllIdentities(): StorefrontIdentityEntry[] {
		return this.getAllEntries()
	}

	public buildNostrJson(requestedName?: string): { names: Record<string, string> } {
		const entries = requestedName ? [this.getEntry(requestedName)] : this.getAllIdentities()
		const names: Record<string, string> = {}
		for (const entry of entries) {
			if (entry) names[entry.name] = entry.pubkey
		}
		return { names }
	}
}

export const STOREFRONT_IDENTITY_PRICING = IDENTITY_PRICING
