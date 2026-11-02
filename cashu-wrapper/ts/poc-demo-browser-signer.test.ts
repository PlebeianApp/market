import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { demoFridayFundingKeyAuthorizationDigest } from './demo-friday-browser-funding-authorization'
import { createDemoFridayPaymentSignerFromSecret } from './poc-demo-browser-signer'
import './poc-demo-browser-signer'

type PaymentSigner = {
	getPublicKey(): Promise<string>
	signCashuSigAllPackage(value: { inputs: Array<{ secret: string }>; outputs: Array<{ B_: string }> }): Promise<{ digest: string; signature: string }>
	signFridayFundingKeyAuthorization(actor: string, value: Parameters<typeof demoFridayFundingKeyAuthorizationDigest>[1]): Promise<string>
}

describe('disposable browser payment signer', () => {
	test('constructs the Cashu digest locally and proves key ownership for one exact funding authorization', async () => {
		const factory = (globalThis as typeof globalThis & { plebeianCreateDemoPaymentSigner(): PaymentSigner }).plebeianCreateDemoPaymentSigner
		const payment = factory(), refund = factory()
		const paymentPublicKey = await payment.getPublicKey(), refundPublicKey = await refund.getPublicKey()
		const B_ = `02${'4'.repeat(64)}`
		const signed = await payment.signCashuSigAllPackage({ inputs: [{ secret: 'exact-bearer-secret' }], outputs: [{ B_ }] })
		const expected = bytesToHex(sha256(new TextEncoder().encode(`exact-bearer-secret${B_}`)))
		expect(signed.digest).toBe(expected)
		expect(schnorr.verify(hexToBytes(signed.signature), hexToBytes(expected), hexToBytes(paymentPublicKey.slice(2)))).toBe(true)
		const terms = {
			schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1' as const,
			authNetworkId: 'friday-demo', chainId: 'friday-chain', auctionId: 'auction-1', amount: 2_500,
			mintUrl: 'http://[fd42::1]:3438', paymentPublicKey, refundPublicKey,
			fundingOperationId: 'funding-1', bundleDigest: '5'.repeat(64), returnPackageDigest: '6'.repeat(64),
			returnCashuSigAllDigest: signed.digest, bidderReturnSignature: signed.signature, expiresAt: 1_200,
		}
		const actor = '6'.repeat(64), digest = demoFridayFundingKeyAuthorizationDigest(actor, terms)
		const proof = await payment.signFridayFundingKeyAuthorization(actor, terms)
		expect(schnorr.verify(hexToBytes(proof), hexToBytes(digest), hexToBytes(paymentPublicKey.slice(2)))).toBe(true)
		expect('signCashuSigAllDigest' in payment).toBe(false)
	})

	test('rejects a malformed Cashu package instead of signing an arbitrary digest', async () => {
		const signer = (globalThis as any).plebeianCreateDemoPaymentSigner() as PaymentSigner
		await expect(signer.signCashuSigAllPackage({ inputs: [], outputs: [] })).rejects.toThrow(/shape/)
	})

	test('reopens one persisted operation key and zeroizes its live signer copy on disposal', async () => {
		const secret = hexToBytes('03'.padStart(64, '0'))
		const first = createDemoFridayPaymentSignerFromSecret(secret)
		const second = createDemoFridayPaymentSignerFromSecret(secret)
		expect(await first.getPublicKey()).toBe(await second.getPublicKey())
		const digest = '7'.repeat(64)
		const signature = await second.signRecipientCapability({
			digest, recipientPublicKey: await second.getPublicKey(), operationId: 'funding-1', role: 'refund',
		})
		expect(schnorr.verify(hexToBytes(signature), hexToBytes(digest), hexToBytes((await second.getPublicKey()).slice(2)))).toBe(true)
		first.dispose()
		await expect(first.getPublicKey()).rejects.toThrow(/disposed/)
		second.dispose()
	})
})
