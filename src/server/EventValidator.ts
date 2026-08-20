import type { NostrEvent } from '@nostr-dev-kit/ndk'
import { getPublicKey } from 'nostr-tools'
import type { EventValidationResult, AdminManager, EditorManager, BootstrapManager, BlacklistManager } from './types'
import { bytesFromHex } from '../lib/utils/keyConversion'
import { AuctionWhitelistManager } from './AuctionWhitelistManager'
import { getAuctionWhitelistConfig } from './runtime'

export class EventValidator {
	private appPrivateKey: string
	private adminManager: AdminManager
	private editorManager: EditorManager
	private bootstrapManager: BootstrapManager
	private auctionWhitelistManager: AuctionWhitelistManager
	private blacklistManager?: BlacklistManager

	constructor(
		appPrivateKey: string,
		adminManager: AdminManager,
		editorManager: EditorManager,
		bootstrapManager: BootstrapManager,
		auctionWhitelistManager?: AuctionWhitelistManager,
		blacklistManager?: BlacklistManager,
	) {
		this.appPrivateKey = appPrivateKey
		this.adminManager = adminManager
		this.editorManager = editorManager
		this.bootstrapManager = bootstrapManager
		this.auctionWhitelistManager = auctionWhitelistManager ?? new AuctionWhitelistManager(getAuctionWhitelistConfig())
		this.blacklistManager = blacklistManager
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
		if (event.kind === 30408) {
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

	private validateAuctionEvent(event: NostrEvent): EventValidationResult {
		// Blacklisted pubkeys are rejected regardless of whitelist mode —
		// auction events must not bypass the app-wide blacklist.
		if (this.blacklistManager?.isBlacklisted(event.pubkey)) {
			return {
				isValid: false,
				reason: 'Auction event rejected: pubkey is blacklisted',
			}
		}

		if (!this.auctionWhitelistManager.isAllowed(event.pubkey)) {
			return {
				isValid: false,
				reason: 'Auction event rejected: pubkey not in whitelist',
			}
		}

		return { isValid: true }
	}
}
