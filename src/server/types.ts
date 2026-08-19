import type { NDKEvent, NostrEvent } from '@nostr-dev-kit/ndk'
import type { UnsignedEvent } from 'nostr-tools/pure'

export interface EventHandlerConfig {
	appPrivateKey: string
	adminPubkeys: string[]
	relayUrl?: string
	auctionWhitelist?: AuctionWhitelistConfig
}

export interface EventValidationResult {
	isValid: boolean
	reason?: string
}

export interface ProcessedEvent {
	originalEvent: NostrEvent
	signedEvent: NostrEvent | null
	validationResult: EventValidationResult
}

export interface AdminManager {
	addAdmin(pubkey: string): void
	isAdmin(pubkey: string): boolean
	getAdmins(): Set<string>
	updateFromEvent(event: NostrEvent | NDKEvent): void
}

export interface EditorManager {
	addEditor(pubkey: string): void
	isEditor(pubkey: string): boolean
	getEditors(): Set<string>
	updateFromEvent(event: NostrEvent | NDKEvent): void
}

export interface BootstrapManager {
	isBootstrapMode(): boolean
	exitBootstrapMode(): void
	handleSetupEvent(event: NostrEvent): void
	hasSetup(): boolean
}

export interface BlacklistManager {
	handleBlacklistEvent(event: NostrEvent): Promise<void>
	isBlacklisted(pubkey: string): boolean
	getBlacklistedPubkeys(): string[]
	loadExistingBlacklist(appPubkey: string): Promise<void>
}

export interface AuctionWhitelistConfig {
	mode: 'whitelist' | 'open'
	pubkeys: string[]
}

export interface AuctionWhitelistManager {
	isWhitelistMode(): boolean
	isOpenMode(): boolean
	getMode(): 'whitelist' | 'open'
	isWhitelisted(pubkey: string): boolean
	isAllowed(pubkey: string): boolean
	getWhitelist(): Set<string>
	setWhitelist(pubkeys: string[]): void
	size(): number
}
