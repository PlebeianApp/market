import { HDKey } from '@scure/bip32'
import { address as baddress, networks, payments } from 'bitcoinjs-lib'
import * as bs58check from 'bs58check'

import { isValidNip05 } from '../utils'
import { PAYMENT_DETAILS_METHOD, type PaymentDetailsMethod } from '../constants'

export type PaymentDetailsResult = {
	success: boolean
	paymentDetails?: string
	method?: (typeof PAYMENT_DETAILS_METHOD)[keyof typeof PAYMENT_DETAILS_METHOD]
	error?: string
}

const XPUB_PREFIX = new Uint8Array([0x04, 0x88, 0xb2, 0x1e])

export function checkExtendedPublicKey(input: string): boolean {
	try {
		bs58check.default.decode(input)
		return true
	} catch (e) {
		e instanceof Error && console.log(e.message)
		return false
	}
}

export function checkAddress(address: string): boolean {
	try {
		const data = baddress.fromBech32(address)
		return !!data
	} catch (e) {
		e instanceof Error && console.log(e.message)
		return false
	}
}

export function zpubToXpub(zpub: string): string | undefined {
	try {
		const data: Uint8Array = bs58check.default.decode(zpub)
		if (!data) return undefined
		const xpubData = new Uint8Array(XPUB_PREFIX.length + data.slice(4).length)
		xpubData.set(XPUB_PREFIX)
		xpubData.set(data.slice(4), XPUB_PREFIX.length)
		return bs58check.default.encode(xpubData)
	} catch (error) {
		console.error('Error converting zpub to xpub:', error)
		return undefined
	}
}

export function deriveAddresses(extendedKey: string, numAddressesToGenerate: number = 10, fromIndex: number = 0): string[] | null {
	try {
		// Early validation - check if the key looks like an extended public key
		if (!extendedKey || typeof extendedKey !== 'string') {
			return null
		}

		// Trim whitespace and validate basic format
		const trimmedKey = extendedKey.trim()
		if (!isExtendedPublicKey(trimmedKey)) {
			return null
		}

		const xpub = trimmedKey.startsWith('zpub') ? zpubToXpub(trimmedKey) : trimmedKey

		if (!xpub || (!xpub.startsWith('xpub') && !isExtendedPublicKey(xpub)) || (xpub.startsWith('xpub') && !checkExtendedPublicKey(xpub))) {
			return null
		}

		const hdkey = HDKey.fromExtendedKey(xpub)

		return Array.from({ length: numAddressesToGenerate }, (_, i) => i + fromIndex)
			.map((i) => hdkey.derive(`m/0/${i}`))
			.map((child) => child.publicKey)
			.map((publicKey) => payments.p2wpkh({ pubkey: publicKey ? Buffer.from(publicKey) : undefined, network: networks.bitcoin }).address!)
	} catch (error) {
		console.error('Error deriving addresses from extended key:', error)
		return null
	}
}

export function isExtendedPublicKey(input: string): boolean {
	if (!input || typeof input !== 'string') {
		return false
	}
	
	const trimmed = input.trim()
	
	// Check if it starts with xpub or zpub and has reasonable length
	const hasValidPrefix = trimmed.startsWith('xpub') || trimmed.startsWith('zpub')
	const hasValidLength = trimmed.length >= 100 && trimmed.length <= 120 // Extended keys are typically 111 characters
	
	return hasValidPrefix && hasValidLength
}

export function validateExtendedPublicKey(input: string): { isValid: boolean; error?: string } {
	if (!input || typeof input !== 'string') {
		return { isValid: false, error: 'Input is required and must be a string' }
	}
	
	const trimmed = input.trim()
	
	// Check basic format
	if (!trimmed.startsWith('xpub') && !trimmed.startsWith('zpub')) {
		return { isValid: false, error: 'Extended public key must start with "xpub" or "zpub"' }
	}
	
	// Check length
	if (trimmed.length < 100 || trimmed.length > 120) {
		return { isValid: false, error: 'Extended public key has invalid length' }
	}
	
	// Try to decode with bs58check
	try {
		bs58check.default.decode(trimmed)
	} catch (error) {
		return { isValid: false, error: 'Invalid base58 encoding in extended public key' }
	}
	
	// If it's a zpub, try converting to xpub
	if (trimmed.startsWith('zpub')) {
		const xpub = zpubToXpub(trimmed)
		if (!xpub) {
			return { isValid: false, error: 'Failed to convert zpub to xpub format' }
		}
	}
	
	return { isValid: true }
}

export async function parsePaymentDetailsFromClipboard(): Promise<PaymentDetailsResult> {
	try {
		const text = (await navigator.clipboard.readText()).trim()

		if (isValidNip05(text)) {
			return {
				success: true,
				paymentDetails: text,
				method: PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK,
			}
		}

		if (text.startsWith('bc1') || isExtendedPublicKey(text)) {
			return {
				success: true,
				paymentDetails: text,
				method: PAYMENT_DETAILS_METHOD.ON_CHAIN,
			}
		}

		return {
			success: false,
			error: 'Unsupported payment details format',
		}
	} catch (error) {
		console.error('Failed to read clipboard:', error)
		return {
			success: false,
			error: 'Failed to read clipboard',
		}
	}
}

export const paymentMethodLabels: Record<PaymentDetailsMethod, string> = {
	[PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK]: 'Lightning Address',
	[PAYMENT_DETAILS_METHOD.ON_CHAIN]: 'Onchain Address',
}

export const paymentMethodIcons: Record<PaymentDetailsMethod, string> = {
	[PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK]: 'i-mingcute-lightning-line',
	[PAYMENT_DETAILS_METHOD.ON_CHAIN]: 'i-mingcute-anchor-line',
}
