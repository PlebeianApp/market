/**
 * demoLnurl.ts — **the demo's LNURL‑requester and bolt11‑codec.**
 *
 * Uses `light-bolt11-decoder` for decoding invoices and Bun's `crypto.subtle` for
 * SHA-256 preimage validation. No dependency on nip47 or nostr-tools for bolt11.
 */
import { decode } from 'light-bolt11-decoder'
import { createHash } from 'node:crypto'
import type { Bolt11InvoiceCodec, Bolt11LnurlRequester } from '@sdk/core/bolt11-wrapper/ts/types'

/**
 * The codec: payment‑hash extraction and preimage validation.
 */
export const lnurlCodec: Bolt11InvoiceCodec = {
	paymentHash(bolt11: string): string {
		const { sections } = decode(bolt11)
		const hash = sections.find((s) => s.name === 'payment_hash')
		if (!hash || !('value' in hash)) throw new Error(`bolt11 carries no payment_hash: ${bolt11.substring(0, 40)}…`)
		return hash.value
	},

	validatePreimage(_bolt11: string, preimage: string): boolean {
		// The payment hash is a SHA-256 of the preimage. We re-hash the supplied preimage and
		// compare hex-encoded. The bolt11-wrapper calls this with the same bolt11 the preimage
		// was handed for; the payment hash was extracted at `obtain` time.
		const hash = createHash('sha256').update(preimage).digest().toHex().toLowerCase()
		return this.paymentHash(_bolt11).toLowerCase() === hash
	},

	expiresAt(bolt11: string): number {
		const decoded = decode(bolt11)
		const tsSection = decoded.sections.find((s) => s.name === 'timestamp')
		const createdAtMs = (tsSection?.value ?? 0) * 1000
		return createdAtMs + decoded.expiry * 1000
	},
}

/**
 * The LNURL‑pay requester. Resolves a lightning address and calls the LNURL‑pay callback.
 * This makes real HTTP calls — the demo is a live server, not a test suite.
 */
export const lnurlRequester: Bolt11LnurlRequester = {
	async requestInvoice(
		lnurl: string,
		amountSat: number,
		_description?: string,
	): Promise<{ bolt11: string; verifyUrl?: string | null }> {
		const paramsResponse = await fetch(lnurl)
		if (!paramsResponse.ok) throw new Error(`LNURL-pay params failed: ${paramsResponse.status}`)

		const params: Record<string, unknown> = await paramsResponse.json()
		const tag = params.tag as string
		const callback = params.callback as string
		const minSendable = params.minSendable as number
		const maxSendable = params.maxSendable as number

		if (tag !== 'payRequest') throw new Error(`unexpected LNURL tag: ${tag}`)
		const msat = amountSat * 1000
		if (msat < minSendable || msat > maxSendable) {
			throw new Error(`amount ${amountSat} sats outside range ${minSendable / 1000}–${maxSendable / 1000} sats`)
		}

		const sep = callback.includes('?') ? '&' : '?'
		const invoiceResponse = await fetch(`${callback}${sep}amount=${msat}`)
		if (!invoiceResponse.ok) throw new Error(`LNURL callback failed: ${invoiceResponse.status}`)

		const result: Record<string, unknown> = await invoiceResponse.json()
		const bolt11 = result.pr as string | undefined
		if (!bolt11) throw new Error(`LNURL callback gave no invoice: ${result.reason ?? 'unknown'}`)

		return { bolt11, verifyUrl: result.verifyUrl as string | undefined }
	},
}