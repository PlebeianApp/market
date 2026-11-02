import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { prepareDemoFridaySellerWinnerPlan } from './demo-friday-browser-coco-seller-plan'
import type { DemoFridaySellerOpeningRefV1 } from './demo-friday-browser-coco-seller-plan'
import type { DemoRecipientPrivateRecord } from './demo-sigall-recipient'
import { demoDenominationKeyDigest } from './demo-sigall-settlement'
import { createDemoFridayPaymentSignerFromSecret } from './poc-demo-browser-signer'

const actorSecret = hexToBytes('11'.padStart(64, '0'))
const sellerActor = bytesToHex(schnorr.getPublicKey(actorSecret))
const recipientSecret = hexToBytes('12'.padStart(64, '0'))

function compressed(value: number): string {
	return bytesToHex(secp256k1.getPublicKey(hexToBytes(value.toString(16).padStart(64, '0')), true))
}

function signed(unsigned: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }) {
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return { ...structuredClone(unsigned), id, sig: bytesToHex(schnorr.sign(hexToBytes(id), actorSecret)) }
}

describe('Friday seller-online Coco winner plan', () => {
	test('publishes only exact blinded outputs and keeps recipient openings browser-private', async () => {
		const keyset = { id: '00seller', unit: 'sat' as const,
			keys: Object.fromEntries([1, 2, 4, 8, 16, 32, 64, 128, 256, 512].map((amount, index) => [String(amount), compressed(30 + index)])) }
		const rows = new Map<string, DemoRecipientPrivateRecord<DemoFridaySellerOpeningRefV1>>()
		const recipient = createDemoFridayPaymentSignerFromSecret(recipientSecret)
		try {
			const envelope = await prepareDemoFridaySellerWinnerPlan({
				challenge: { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_V1',
					authNetworkId: 'friday-network', chainId: 'friday-chain', auctionId: 'auction-1',
					fundingOperationId: 'funding-1',
					sellerActor, sellerPaymentPublicKey: await recipient.getPublicKey(),
					bidderActor: '3'.repeat(64), bidAmount: 600,
					canonicalMintUrl: 'https://172.105.64.142', activeSatKeysetId: keyset.id,
					denominationKeyDigest: demoDenominationKeyDigest(keyset.keys), expiresAt: 1_200 },
				keyset, nowSeconds: 1_000,
				journal: {
					async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() },
					async load(scope) { return structuredClone(rows.get(scope) ?? null) },
					async savePrepared(scope, record) { rows.set(scope, structuredClone(record)) },
					async markImported() { throw new Error('unused') },
				},
				recipientKey: recipient,
				nostr: { async getPublicKey() { return sellerActor }, async signEvent(value) { return signed(value) } },
			})
			expect(envelope.plan.bidAmount).toBe(600)
			expect(envelope.plan.recipientPlan.outputs.reduce((sum, output) => sum + output.amount, 0)).toBe(600)
			expect(envelope.plan.recipientPublicKey).toBe(await recipient.getPublicKey())
			expect(envelope.sellerAuthorization.pubkey).toBe(sellerActor)
			const publicJson = JSON.stringify(envelope)
			const privateRow = [...rows.values()][0]!
			for (const opening of privateRow.privateOpeningRefs) {
				expect(publicJson).not.toContain(opening.secret)
				expect(publicJson).not.toContain(opening.r)
			}
			expect(publicJson).not.toContain(bytesToHex(recipientSecret))
		} finally { recipient.dispose() }
	})
})
