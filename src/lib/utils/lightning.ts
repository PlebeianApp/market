/**
 * Lightning Network utilities for generating invoices and handling payments
 * Enhanced with Nostr zap support and better payment verification
 */

interface LnurlPayResponse {
	callback: string
	maxSendable: number
	minSendable: number
	metadata: string
	commentAllowed?: number
	tag: string
	allowsNostr?: boolean
	nostrPubkey?: string
}

interface LnurlInvoiceResponse {
	pr: string // BOLT11 invoice
	routes: any[]
	verify?: string // Payment verification URL
	successAction?: {
		tag: string
		message?: string
		url?: string
	}
}

interface LightningInvoiceResult {
	bolt11: string
	amount: number
	description: string
	expiresAt: number
	paymentHash?: string
	verifyUrl?: string
	allowsNostr?: boolean
}

interface PaymentVerificationResult {
	settled: boolean
	preimage?: string
	settledAt?: number
}

export class LightningService {
	private static readonly ZAP_RELAYS = [
		'wss://relay.damus.io',
		'wss://relay.nostr.band',
		'wss://nos.lol',
		'wss://relay.nostr.net',
		'wss://relay.minibits.cash',
		// 'wss://relay.coinos.io/',
	]

	/**
	 * Generate an invoice from a Lightning address (LUD16) with enhanced Nostr support
	 * @param lightningAddress The Lightning address (e.g., user@domain.com)
	 * @param amountSats Amount in satoshis
	 * @param description Invoice description
	 * @param options Additional options for Nostr zaps
	 * @returns Lightning invoice details
	 */
	static async generateInvoiceFromLightningAddress(
		lightningAddress: string,
		amountSats: number,
		description: string = 'Payment',
		options?: {
			enableNostr?: boolean
			zapRequest?: string
			relays?: string[]
		},
	): Promise<LightningInvoiceResult> {
		try {
			// Parse Lightning address
			const [username, domain] = lightningAddress.split('@')
			if (!username || !domain) {
				throw new Error('Invalid Lightning address format')
			}

			// Step 1: Fetch LNURL-pay info
			const lnurlPayUrl = `https://${domain}/.well-known/lnurlp/${username}`
			console.log(`Fetching LNURL-pay info from: ${lnurlPayUrl}`)

			const lnurlResponse = await fetch(lnurlPayUrl)
			if (!lnurlResponse.ok) {
				throw new Error(`Failed to fetch LNURL-pay info: ${lnurlResponse.status}`)
			}

			const lnurlData: LnurlPayResponse = await lnurlResponse.json()
			console.log('LNURL-pay data:', lnurlData)

			// Validate amount bounds
			const amountMsats = amountSats * 1000
			if (amountMsats < lnurlData.minSendable || amountMsats > lnurlData.maxSendable) {
				throw new Error(
					`Amount ${amountSats} sats is outside allowed range: ${lnurlData.minSendable / 1000}-${lnurlData.maxSendable / 1000} sats`,
				)
			}

			// Step 2: Request invoice with Nostr support
			const callbackUrl = new URL(lnurlData.callback)
			callbackUrl.searchParams.append('amount', amountMsats.toString())
			callbackUrl.searchParams.append('comment', description)

			// Add Nostr zap parameters if supported and enabled
			if (lnurlData.allowsNostr && options?.enableNostr && options?.zapRequest) {
				callbackUrl.searchParams.append('nostr', options.zapRequest)
			}

			console.log(`Requesting invoice from: ${callbackUrl.toString()}`)

			const invoiceResponse = await fetch(callbackUrl.toString())
			if (!invoiceResponse.ok) {
				throw new Error(`Failed to generate invoice: ${invoiceResponse.status}`)
			}

			const invoiceData: LnurlInvoiceResponse = await invoiceResponse.json()
			console.log('Invoice response:', invoiceData)

			if (!invoiceData.pr) {
				throw new Error('No payment request in response')
			}

			// Parse the BOLT11 invoice for details
			const bolt11Details = this.parseBolt11Invoice(invoiceData.pr)

			return {
				bolt11: invoiceData.pr,
				amount: amountSats,
				description,
				expiresAt: bolt11Details.expiresAt,
				paymentHash: bolt11Details.paymentHash,
				verifyUrl: invoiceData.verify,
				allowsNostr: lnurlData.allowsNostr,
			}
		} catch (error) {
			console.error('Failed to generate Lightning invoice:', error)
			throw error
		}
	}

	/**
	 * Parse BOLT11 invoice to extract key information
	 * @param bolt11 The BOLT11 invoice string
	 * @returns Parsed invoice details
	 */
	static parseBolt11Invoice(bolt11: string): { expiresAt: number; paymentHash?: string } {
		try {
			// Basic BOLT11 parsing - in production, use a proper library like bolt11
			// For now, we'll extract what we can and default the rest

			// Default expiry is 1 hour from now
			let expiresAt = Math.floor(Date.now() / 1000) + 3600

			// Try to extract timestamp from the invoice
			const parts = bolt11.toLowerCase().split('1')
			if (parts.length >= 2) {
				// The timestamp is encoded in the invoice, but proper parsing requires
				// a full BOLT11 decoder. For now, use default.
				expiresAt = Math.floor(Date.now() / 1000) + 3600
			}

			return {
				expiresAt,
				paymentHash: undefined, // Would need full BOLT11 decoder
			}
		} catch (error) {
			console.warn('Failed to parse BOLT11 invoice, using defaults:', error)
			return {
				expiresAt: Math.floor(Date.now() / 1000) + 3600,
			}
		}
	}

	/**
	 * Verify payment status using the verification URL
	 * @param verifyUrl The verification URL from the invoice response
	 * @returns Payment verification result
	 */
	static async verifyPayment(verifyUrl: string): Promise<PaymentVerificationResult> {
		try {
			const response = await fetch(verifyUrl)
			if (!response.ok) {
				throw new Error(`Verification request failed: ${response.status}`)
			}

			const result = await response.json()

			return {
				settled: result.settled || result.paid || false,
				preimage: result.preimage,
				settledAt: result.settledAt ? new Date(result.settledAt).getTime() / 1000 : undefined,
			}
		} catch (error) {
			console.error('Payment verification failed:', error)
			return { settled: false }
		}
	}

	/**
	 * Generate a mock Lightning invoice for testing
	 */
	static generateMockInvoice(amountSats: number, description: string = 'Payment'): LightningInvoiceResult {
		const expiresAt = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
		const mockBolt11 = `lnbc${amountSats}n1pj${Math.random().toString(36).substring(2)}` // Mock BOLT11

		return {
			bolt11: mockBolt11,
			amount: amountSats,
			description,
			expiresAt,
			paymentHash: Math.random().toString(36).substring(2),
			verifyUrl: undefined,
			allowsNostr: false,
		}
	}

	/**
	 * Validate Lightning address format
	 */
	static isValidLightningAddress(lightningAddress: string): boolean {
		if (!lightningAddress || typeof lightningAddress !== 'string') {
			return false
		}

		// Basic format validation: user@domain.com
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
		return emailRegex.test(lightningAddress)
	}

	/**
	 * Get Lightning address info from LNURL endpoint
	 */
	static async getLightningAddressInfo(lightningAddress: string): Promise<{
		reachable: boolean
		allowsNostr?: boolean
		nostrPubkey?: string
		minSendable?: number
		maxSendable?: number
	}> {
		try {
			const [username, domain] = lightningAddress.split('@')
			if (!username || !domain) {
				return { reachable: false }
			}

			const lnurlPayUrl = `https://${domain}/.well-known/lnurlp/${username}`
			const response = await fetch(lnurlPayUrl, {
				method: 'GET',
				headers: {
					Accept: 'application/json',
				},
			})

			if (!response.ok) {
				return { reachable: false }
			}

			const data: LnurlPayResponse = await response.json()

			return {
				reachable: true,
				allowsNostr: data.allowsNostr,
				nostrPubkey: data.nostrPubkey,
				minSendable: data.minSendable,
				maxSendable: data.maxSendable,
			}
		} catch (error) {
			console.error('Failed to get Lightning address info:', error)
			return { reachable: false }
		}
	}

	/**
	 * Check if Lightning address is reachable
	 */
	static async checkLightningAddressReachable(lightningAddress: string): Promise<boolean> {
		const info = await this.getLightningAddressInfo(lightningAddress)
		return info.reachable
	}

	/**
	 * Start polling for payment verification
	 */
	static startPaymentPolling(
		verifyUrl: string,
		onSuccess: (result: PaymentVerificationResult) => void,
		onError: (error: string) => void,
		intervalMs: number = 2000,
	): () => void {
		const interval = setInterval(async () => {
			try {
				const result = await this.verifyPayment(verifyUrl)
				if (result.settled) {
					clearInterval(interval)
					onSuccess(result)
				}
			} catch (error) {
				clearInterval(interval)
				onError(error instanceof Error ? error.message : 'Payment verification failed')
			}
		}, intervalMs)

		// Return cleanup function
		return () => clearInterval(interval)
	}
}

export type { LightningInvoiceResult, PaymentVerificationResult }

// Lightning Address validation regex
export const LN_ADDRESS_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Validates if a string is a valid Lightning Address
 */
export function isValidLightningAddress(address: string): boolean {
	return LN_ADDRESS_REGEX.test(address)
}

/**
 * Extracts lightning address from a profile (lud16 or lud06)
 */
export function extractLightningAddress(profile: any): string | null {
	return profile?.lud16 || profile?.lud06 || null
}

/**
 * Creates a lightning URI from an invoice
 */
export function createLightningUri(invoice: string): string {
	return `lightning:${invoice}`
}

/**
 * Formats seconds into a readable time format
 */
export function formatTime(totalSeconds: number | null): string {
	if (totalSeconds === null) return '--:--'

	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60

	if (hours > 0) {
		return `${hours}h ${minutes}m ${seconds}s`
	}
	return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Checks if an invoice has expired based on its timestamp and expiry
 */
export function isInvoiceExpired(invoice: string): boolean {
	try {
		// This would need a proper lightning invoice parser
		// For now, return false as a placeholder
		return false
	} catch {
		return true
	}
}

export * from './mempool'
export * from './paymentDetails'
