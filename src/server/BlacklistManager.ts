import type { NostrEvent } from '@nostr-dev-kit/ndk'
import NDK from '@nostr-dev-kit/ndk'
import type { EventSigner } from './EventSigner'
import type { NDKService } from './NDKService'

export interface BlacklistManager {
	handleBlacklistEvent(event: NostrEvent): Promise<void>
	isBlacklisted(pubkey: string): boolean
	isProductBlacklisted(productCoords: string): boolean
	isCollectionBlacklisted(collectionCoords: string): boolean
	getBlacklistedPubkeys(): string[]
	getBlacklistedProducts(): string[]
	getBlacklistedCollections(): string[]
}

export class BlacklistManagerImpl implements BlacklistManager {
	private blacklistedPubkeys: Set<string> = new Set()
	private blacklistedProducts: Set<string> = new Set()
	private blacklistedCollections: Set<string> = new Set()
	private eventSigner: EventSigner
	private ndkService: NDKService
	private ndk: NDK | null = null

	constructor(eventSigner: EventSigner, ndkService: NDKService) {
		this.eventSigner = eventSigner
		this.ndkService = ndkService
	}

	public setNDK(ndk: NDK): void {
		this.ndk = ndk
	}

	public async handleBlacklistEvent(event: NostrEvent): Promise<void> {
		console.log('Processing blacklist event:', event.id)

		// Extract blacklisted items from the event tags
		const newBlacklistedPubkeys = this.extractBlacklistedPubkeys(event)
		const newBlacklistedProducts = this.extractBlacklistedProducts(event)
		const newBlacklistedCollections = this.extractBlacklistedCollections(event)
		const previouslyBlacklisted = new Set(this.blacklistedPubkeys)

		// Update the internal blacklists
		this.blacklistedPubkeys.clear()
		newBlacklistedPubkeys.forEach((pubkey) => this.blacklistedPubkeys.add(pubkey))

		this.blacklistedProducts.clear()
		newBlacklistedProducts.forEach((coords) => this.blacklistedProducts.add(coords))

		this.blacklistedCollections.clear()
		newBlacklistedCollections.forEach((coords) => this.blacklistedCollections.add(coords))

		// Find newly blacklisted pubkeys
		const newlyBlacklisted = newBlacklistedPubkeys.filter((pubkey) => !previouslyBlacklisted.has(pubkey))

		if (newlyBlacklisted.length > 0) {
			console.log('Newly blacklisted pubkeys:', newlyBlacklisted)

			// Delete all events from newly blacklisted pubkeys
			for (const pubkey of newlyBlacklisted) {
				await this.deleteEventsFromPubkey(pubkey)
			}
		}
	}

	private extractBlacklistedPubkeys(event: NostrEvent): string[] {
		// Extract pubkeys from 'p' tags as per NIP-51 mute list specification
		return event.tags
			.filter((tag) => tag[0] === 'p' && tag[1])
			.map((tag) => tag[1])
			.filter((pubkey) => /^[0-9a-f]{64}$/i.test(pubkey)) // Validate hex format
	}

	private extractBlacklistedProducts(event: NostrEvent): string[] {
		// Extract product coordinates from 'a' tags with kind 30402
		return event.tags.filter((tag) => tag[0] === 'a' && tag[1] && tag[1].startsWith('30402:')).map((tag) => tag[1])
	}

	private extractBlacklistedCollections(event: NostrEvent): string[] {
		// Extract collection coordinates from 'a' tags with kind 30405
		return event.tags.filter((tag) => tag[0] === 'a' && tag[1] && tag[1].startsWith('30405:')).map((tag) => tag[1])
	}

	private async deleteEventsFromPubkey(pubkey: string): Promise<void> {
		if (!this.ndk) {
			console.warn('NDK not available, cannot delete events from blacklisted pubkey:', pubkey)
			return
		}

		try {
			console.log('Fetching events from blacklisted pubkey:', pubkey)

			// Fetch all events from the blacklisted pubkey
			const eventsToDelete = await this.ndk.fetchEvents({
				authors: [pubkey],
				limit: 1000, // Reasonable limit to avoid overwhelming the system
			})

			if (eventsToDelete.size === 0) {
				console.log('No events found for blacklisted pubkey:', pubkey)
				return
			}

			console.log(`Found ${eventsToDelete.size} events to delete from pubkey: ${pubkey}`)

			// MOCK IMPLEMENTATION: Log deletion intent without creating actual deletion events
			// TODO: Implement proper deletion mechanism (admin cannot create deletion events for events they didn't author)
			Array.from(eventsToDelete).forEach((eventToDelete) => {
				console.log(`MOCK: Would delete event ${eventToDelete.id} (kind: ${eventToDelete.kind}) from blacklisted pubkey: ${pubkey}`)
			})

			console.log(`MOCK: Completed deletion process for pubkey: ${pubkey} (${eventsToDelete.size} events marked for deletion)`)
		} catch (error) {
			console.error(`Error processing events from pubkey ${pubkey}:`, error)
		}
	}

	public isBlacklisted(pubkey: string): boolean {
		return this.blacklistedPubkeys.has(pubkey)
	}

	public isProductBlacklisted(productCoords: string): boolean {
		return this.blacklistedProducts.has(productCoords)
	}

	public isCollectionBlacklisted(collectionCoords: string): boolean {
		return this.blacklistedCollections.has(collectionCoords)
	}

	public getBlacklistedPubkeys(): string[] {
		return Array.from(this.blacklistedPubkeys)
	}

	public getBlacklistedProducts(): string[] {
		return Array.from(this.blacklistedProducts)
	}

	public getBlacklistedCollections(): string[] {
		return Array.from(this.blacklistedCollections)
	}

	public async loadExistingBlacklist(appPubkey: string): Promise<void> {
		if (!this.ndk) {
			console.warn('NDK not available, cannot load existing blacklist')
			return
		}

		try {
			// Fetch the most recent blacklist event (kind 10000) from the app
			const blacklistEvents = await this.ndk.fetchEvents({
				kinds: [10000],
				authors: [appPubkey],
				limit: 1,
			})

			if (blacklistEvents.size > 0) {
				const latestBlacklistEvent = Array.from(blacklistEvents)[0]
				const rawEvent = latestBlacklistEvent.rawEvent()
				const blacklistedPubkeys = this.extractBlacklistedPubkeys(rawEvent)
				const blacklistedProducts = this.extractBlacklistedProducts(rawEvent)
				const blacklistedCollections = this.extractBlacklistedCollections(rawEvent)

				this.blacklistedPubkeys.clear()
				blacklistedPubkeys.forEach((pubkey) => this.blacklistedPubkeys.add(pubkey))

				this.blacklistedProducts.clear()
				blacklistedProducts.forEach((coords) => this.blacklistedProducts.add(coords))

				this.blacklistedCollections.clear()
				blacklistedCollections.forEach((coords) => this.blacklistedCollections.add(coords))

				console.log(
					`Loaded ${blacklistedPubkeys.length} blacklisted pubkeys, ${blacklistedProducts.length} products, ${blacklistedCollections.length} collections from existing blacklist`,
				)
			}
		} catch (error) {
			console.error('Error loading existing blacklist:', error)
		}
	}
}
