import { describe, expect, test } from 'bun:test'
import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'
import { AdminManagerImpl } from '@/server/AdminManager'
import { BootstrapManagerImpl } from '@/server/BootstrapManager'
import { EditorManagerImpl } from '@/server/EditorManager'
import { EventValidator } from '@/server/EventValidator'
import { AuctionWhitelistManager } from '@/server/AuctionWhitelistManager'
import type { BlacklistManager } from '@/server/types'

const APP_PRIVATE_KEY = 'a'.repeat(64)
const MERCHANT_PUBKEY = getPublicKey(hexToBytes('b'.repeat(64)))
const OTHER_PUBKEY = getPublicKey(hexToBytes('c'.repeat(64)))

type ValidatorEvent = Parameters<EventValidator['validateEvent']>[0]

function auctionEvent(pubkey: string): ValidatorEvent {
	return {
		kind: 30408,
		pubkey,
		created_at: 1,
		tags: [['d', 'test-auction']],
		content: '',
	} as ValidatorEvent
}

function blacklistStub(blacklisted: string[]): BlacklistManager {
	const set = new Set(blacklisted)
	return {
		isBlacklisted: (pubkey: string) => set.has(pubkey),
		isProductBlacklisted: () => false,
		isCollectionBlacklisted: () => false,
		getBlacklistedPubkeys: () => blacklisted,
		getBlacklistedProducts: () => [],
		getBlacklistedCollections: () => [],
		loadExistingBlacklist: async () => {},
	} as BlacklistManager
}

function validatorFor(opts?: { whitelistManager?: AuctionWhitelistManager; blacklistManager?: BlacklistManager }): EventValidator {
	return new EventValidator(
		APP_PRIVATE_KEY,
		new AdminManagerImpl(),
		new EditorManagerImpl(),
		new BootstrapManagerImpl(new AdminManagerImpl()),
		opts?.whitelistManager,
		opts?.blacklistManager,
	)
}

describe('auction whitelist validation', () => {
	test('default config (env unset) is open mode — any pubkey may publish kind-30408', () => {
		const validator = validatorFor()

		expect(validator.validateEvent(auctionEvent(MERCHANT_PUBKEY))).toEqual({ isValid: true })
		expect(validator.validateEvent(auctionEvent(OTHER_PUBKEY))).toEqual({ isValid: true })
	})

	test('whitelist mode rejects pubkeys that are not listed', () => {
		const whitelist = new AuctionWhitelistManager({ mode: 'whitelist', pubkeys: [MERCHANT_PUBKEY] })
		const validator = validatorFor({ whitelistManager: whitelist })

		expect(validator.validateEvent(auctionEvent(MERCHANT_PUBKEY))).toEqual({ isValid: true })
		expect(validator.validateEvent(auctionEvent(OTHER_PUBKEY))).toEqual({
			isValid: false,
			reason: 'Auction event rejected: pubkey not in whitelist',
		})
	})

	test('blacklisted pubkeys are rejected even in open mode', () => {
		const validator = validatorFor({ blacklistManager: blacklistStub([OTHER_PUBKEY]) })

		expect(validator.validateEvent(auctionEvent(OTHER_PUBKEY))).toEqual({
			isValid: false,
			reason: 'Auction event rejected: pubkey is blacklisted',
		})
		// Non-blacklisted pubkeys are still accepted in open mode
		expect(validator.validateEvent(auctionEvent(MERCHANT_PUBKEY))).toEqual({ isValid: true })
	})

	test('blacklist takes precedence over whitelist membership', () => {
		const whitelist = new AuctionWhitelistManager({ mode: 'whitelist', pubkeys: [MERCHANT_PUBKEY] })
		const validator = validatorFor({
			whitelistManager: whitelist,
			blacklistManager: blacklistStub([MERCHANT_PUBKEY]),
		})

		expect(validator.validateEvent(auctionEvent(MERCHANT_PUBKEY))).toEqual({
			isValid: false,
			reason: 'Auction event rejected: pubkey is blacklisted',
		})
	})

	test('manager normalizes config: whitespace entries trimmed, invalid mode degrades to open', () => {
		const whitelist = new AuctionWhitelistManager({
			mode: ' whitelist ' as 'whitelist',
			pubkeys: [` ${MERCHANT_PUBKEY} `, '', '   '],
		})

		// Invalid mode string degrades to open: everyone may publish
		expect(whitelist.getConfig()).toEqual({ mode: 'open', pubkeyCount: 1 })
		expect(whitelist.isAllowed(OTHER_PUBKEY)).toBe(true)

		const strict = new AuctionWhitelistManager({ mode: 'whitelist', pubkeys: [` ${MERCHANT_PUBKEY} `, ''] })
		// Trimmed entry is still recognized
		expect(strict.isAllowed(MERCHANT_PUBKEY)).toBe(true)
		expect(strict.isAllowed(OTHER_PUBKEY)).toBe(false)
		expect(strict.getConfig()).toEqual({ mode: 'whitelist', pubkeyCount: 1 })
	})
})
