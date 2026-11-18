import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { EventSigner } from './EventSigner'
import { Nip05ManagerImpl } from './Nip05Manager'
import { STOREFRONT_IDENTITY_PRICING, StorefrontIdentityManager } from './StorefrontIdentityManager'
import type { PurchaseValidationStage } from './ZapPurchaseManager'
import { VanityManagerImpl } from './VanityManager'
import type { NostrEvent } from '@nostr-dev-kit/ndk'

class TestableStorefrontIdentityManager extends StorefrontIdentityManager {
	validateAmount(amountSats: number, name: string, pubkey: string, zapRequest: NostrEvent, stage: PurchaseValidationStage) {
		return this.validatePurchaseAmount(amountSats, name, pubkey, zapRequest, stage)
	}

	validateName(name: string, pubkey: string) {
		return this.validateRegistration(name, pubkey)
	}
}

describe('StorefrontIdentityManager', () => {
	test('charges once for a missing legacy identity and rejects a name held by another account', async () => {
		const appSecret = generateSecretKey()
		const ownerSecret = generateSecretKey()
		const otherSecret = generateSecretKey()
		const appPubkey = getPublicKey(appSecret)
		const ownerPubkey = getPublicKey(ownerSecret)
		const signer = new EventSigner(bytesToHex(appSecret))
		const vanity = new VanityManagerImpl(signer)
		const nip05 = new Nip05ManagerImpl(signer)
		const manager = new TestableStorefrontIdentityManager(signer, 'test-handler', vanity, nip05)
		const validUntil = Math.floor(Date.now() / 1000) + 60 * 60
		const legacyRegistry = finalizeEvent(
			{
				kind: 30000,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['d', 'vanity-urls'],
					['vanity', 'alice', ownerPubkey, String(validUntil)],
				],
				content: '',
			},
			appSecret,
		)

		vanity.setAppPubkey(appPubkey)
		await vanity.handleRegistryEvent(legacyRegistry)

		expect(manager.getChargeCount('alice', ownerPubkey)).toBe(1)
		const validRequest = finalizeEvent(
			{
				kind: 9734,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['tier', '6mo'],
					['count', '1'],
				],
				content: '',
			},
			ownerSecret,
		)
		expect(manager.validateAmount(10_000, 'alice', ownerPubkey, validRequest, 'invoice')).toBeNull()
		expect(manager.validateAmount(20_000, 'alice', ownerPubkey, validRequest, 'invoice')).toContain('does not match')
		expect(manager.validateName('alice', getPublicKey(otherSecret))).toContain('held by another account')
	})

	test('prices both identity forms at the sum of their existing rates', () => {
		expect(STOREFRONT_IDENTITY_PRICING['both-6mo'].sats).toBe(20_000)
		expect(STOREFRONT_IDENTITY_PRICING['both-1yr'].sats).toBe(36_000)
	})
})
