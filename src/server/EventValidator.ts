import type { NostrEvent } from '@nostr-dev-kit/ndk'
import { getPublicKey } from 'nostr-tools'
import type { EventValidationResult, AdminManager, EditorManager, BootstrapManager } from './types'
import { bytesFromHex } from '../lib/utils/keyConversion'

export class EventValidator {
	private appPrivateKey: string
	private adminManager: AdminManager
	private editorManager: EditorManager
	private bootstrapManager: BootstrapManager

	constructor(appPrivateKey: string, adminManager: AdminManager, editorManager: EditorManager, bootstrapManager: BootstrapManager) {
		this.appPrivateKey = appPrivateKey
		this.adminManager = adminManager
		this.editorManager = editorManager
		this.bootstrapManager = bootstrapManager
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
}
