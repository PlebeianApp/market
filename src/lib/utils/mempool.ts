export interface MempoolTransaction {
	txid: string
	version: number
	locktime: number
	vin: Vin[]
	vout: Vout[]
	size: number
	weight: number
	fee: number
	status: {
		confirmed: boolean
		block_height?: number
		block_hash?: string
		block_time?: number
	}
}

export interface Vin {
	txid: string
	vout: number
	prevout: {
		scriptpubkey: string
		scriptpubkey_asm: string
		scriptpubkey_type: string
		scriptpubkey_address: string
		value: number
	}
	scriptsig: string
	scriptsig_asm: string
	witness: string[]
	is_coinbase: boolean
	sequence: number
	inner_witnessscript_asm: string
}

export interface Vout {
	scriptpubkey: string
	scriptpubkey_asm: string
	scriptpubkey_type: string
	scriptpubkey_address: string
	value: number
}

const MEMPOOL_API_BASE = 'https://mempool.space/api'

export class MempoolService {
	/**
	 * Fetches transactions for a given Bitcoin address
	 */
	static async fetchAddressTransactions(address: string): Promise<MempoolTransaction[]> {
		const response = await fetch(`${MEMPOOL_API_BASE}/address/${address}/txs`)
		if (!response.ok) {
			throw new Error(`Failed to fetch address transactions: ${response.statusText}`)
		}
		return await response.json()
	}

	/**
	 * Checks if a specific payment has been received
	 */
	static async checkPaymentReceived(address: string, expectedAmountSats: number): Promise<MempoolTransaction | null> {
		try {
			const transactions = await this.fetchAddressTransactions(address)

			// Find transaction with matching amount and address
			const matchingTx = transactions.find((tx) =>
				tx.vout.some((output) => output.value === expectedAmountSats && output.scriptpubkey_address === address),
			)

			return matchingTx || null
		} catch (error) {
			console.error('Error checking payment:', error)
			throw error
		}
	}

	/**
	 * Polls for payment confirmation with exponential backoff
	 */
	static async pollForPayment(
		address: string,
		expectedAmountSats: number,
		options: {
			maxAttempts?: number
			initialDelayMs?: number
			maxDelayMs?: number
			timeoutMs?: number
		} = {},
	): Promise<MempoolTransaction> {
		const {
			maxAttempts = 60, // 5 minutes at 5-second intervals
			initialDelayMs = 5000,
			maxDelayMs = 30000,
			timeoutMs = 30 * 60 * 1000, // 30 minutes
		} = options

		const startTime = Date.now()
		let attempt = 0
		let delay = initialDelayMs

		while (attempt < maxAttempts && Date.now() - startTime < timeoutMs) {
			try {
				const transaction = await this.checkPaymentReceived(address, expectedAmountSats)
				if (transaction) {
					return transaction
				}
			} catch (error) {
				console.warn(`Payment check attempt ${attempt + 1} failed:`, error)
			}

			attempt++

			// Wait before next attempt
			await new Promise((resolve) => setTimeout(resolve, delay))

			// Exponential backoff with max delay
			delay = Math.min(delay * 1.5, maxDelayMs)
		}

		throw new Error('Payment polling timeout or max attempts reached')
	}

	/**
	 * Generates a Bitcoin URI for payment
	 */
	static generateBitcoinUri(address: string, amountBtc: number, label?: string): string {
		const params = new URLSearchParams()
		params.set('amount', amountBtc.toString())
		if (label) {
			params.set('label', label)
		}
		return `bitcoin:${address}?${params.toString()}`
	}

	/**
	 * Converts satoshis to BTC
	 */
	static satoshisToBtc(sats: number): number {
		return sats / 100000000
	}

	/**
	 * Converts BTC to satoshis
	 */
	static btcToSatoshis(btc: number): number {
		return Math.round(btc * 100000000)
	}

	/**
	 * Validates Bitcoin address format (basic validation)
	 */
	static isValidBitcoinAddress(address: string): boolean {
		// Basic validation for common Bitcoin address formats
		const patterns = [
			/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/, // Legacy (P2PKH, P2SH)
			/^bc1[a-z0-9]{39,59}$/, // Bech32 (P2WPKH, P2WSH)
			/^bc1p[a-z0-9]{58}$/, // Bech32m (P2TR)
		]

		return patterns.some((pattern) => pattern.test(address))
	}
} 