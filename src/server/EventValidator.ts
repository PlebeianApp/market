import type { NostrEvent } from '@nostr-dev-kit/ndk'
import { getPublicKey } from 'nostr-tools'
import type { EventValidationResult, AdminManager, EditorManager, BootstrapManager, AuctionWhitelistManager } from './types'
import { bytesFromHex } from '../lib/utils/keyConversion'

/** Auction event kind (NIP-53 / Plebeian auction protocol). */
const AUCTION_KIND = 30408

export class EventValidator {
	private appPrivateKey: string
	private adminManager: AdminManager
	private editorManager: EditorManager
	private bootstrapManager: BootstrapManager
	private auctionWhitelistManager: AuctionWhitelistManager | null

	constructor(
		appPrivateKey: string,
		adminManager: AdminManager,
		editorManager: EditorManager,
		bootstrapManager: BootstrapManager,
		auctionWhitelistManager: AuctionWhitelistManager | null = null,
	) {
		this.appPrivateKey = appPrivateKey
		this.adminManager = adminManager
		this.editorManager = editorManager
		this.bootstrapManager = bootstrapManager
		this.auctionWhitelistManager = auctionWhitelistManager
	}

	public validateEvent(event: NostrEvent): EventValidationResult {
		const eventType = this.getEventType(event)

		switch (eventType) {
			case 'setup':
				return this.validateSetupEvent(event)
			case 'adminList':
			case 'editorList':
				return this.validateRoleListEvent(event)
			case 'blacklist':
				return this.validateBlacklistEvent(event)
			case 'auction':
				return this.validateAuctionEvent(event)
			default:
				return this.validateGeneralEvent(event)
		}
	}

	private getEventType(event: NostrEvent): string {
		if (event.kind === 31990 && event.content.includes('"name":')) {
			return 'setup'
		}
		if (event.kind === 30000) {
			const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
			if (dTag === 'admins') return 'adminList'
			if (dTag === 'editors') return 'editorList'
		}
		if (event.kind === 10000) {
			return 'blacklist'
		}
		if (event.kind === AUCTION_KIND) {
			return 'auction'
		}
		return 'general'
	}

	private validateSetupEvent(event: NostrEvent): EventValidationResult {
		const appPubkey = getPublicKey(bytesFromHex(this.appPrivateKey))

		if (!this.bootstrapManager.isBootstrapMode() && event.pubkey !== appPubkey && !this.adminManager.isAdmin(event.pubkey)) {
			return {
				isValid: false,
				reason: 'Setup event rejected: not in bootstrap mode and not signed by app or admin',
			}
		}

		return { isValid: true }
	}

	private validateRoleListEvent(event: NostrEvent): EventValidationResult {
		if (!this.bootstrapManager.isBootstrapMode() && !this.adminManager.isAdmin(event.pubkey)) {
			return {
				isValid: false,
				reason: 'Role list event rejected: not in bootstrap mode and not from admin',
			}
		}

		return { isValid: true }
	}

	private validateBlacklistEvent(event: NostrEvent): EventValidationResult {
		if (!this.adminManager.isAdmin(event.pubkey) && !this.editorManager.isEditor(event.pubkey)) {
			return {
				isValid: false,
				reason: 'Blacklist event rejected: not from admin or editor',
			}
		}

		return { isValid: true }
	}

	private validateGeneralEvent(event: NostrEvent): EventValidationResult {
		if (!this.adminManager.isAdmin(event.pubkey)) {
			return {
				isValid: false,
				reason: 'General event rejected: not from admin',
			}
		}

		return { isValid: true }
	}

	/**
	 * Validate a kind-30408 auction event against the whitelist policy.
	 *
	 * When no AuctionWhitelistManager is configured (null) or the manager is
	 * in 'open' mode, all pubkeys are allowed (backward-compatible default).
	 *
	 * When the manager is in 'whitelist' mode, only pubkeys in the whitelist
	 * set are accepted. Admins are always allowed regardless of whitelist
	 * mode, so the app owner can manage auctions even under strict mode.
	 */
	private validateAuctionEvent(event: NostrEvent): EventValidationResult {
		// No whitelist manager configured → open by default (backward compat)
		if (!this.auctionWhitelistManager) {
			return { isValid: true }
		}

		// Open mode → allow all
		if (this.auctionWhitelistManager.isOpenMode()) {
			return { isValid: true }
		}

		// Whitelist mode — admins always pass
		if (this.adminManager.isAdmin(event.pubkey)) {
			return { isValid: true }
		}

		// Whitelist mode — check the pubkey against the whitelist
		if (this.auctionWhitelistManager.isWhitelisted(event.pubkey)) {
			return { isValid: true }
		}

		return {
			isValid: false,
			reason: 'Auction event rejected: pubkey not in auction whitelist',
		}
	}
}
