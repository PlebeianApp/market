/**
 * Payment utilities for handling Lightning Network payments
 * Extracted from LightningPaymentProcessor for better separation of concerns
 */

import { Invoice } from '@getalby/lightning-tools'
import { walletActions } from '@/lib/stores/wallet'
import type { NDKSigner } from '@nostr-dev-kit/ndk'

// WebLN types
declare global {
    interface Window {
        webln?: {
            enable(): Promise<void>
            sendPayment(paymentRequest: string): Promise<{ preimage: string }>
        }
    }
}

export interface PaymentResult {
    success: boolean
    preimage?: string
    error?: string
}

/**
 * Validate a preimage against an invoice's payment hash
 * Returns true if SHA256(preimage) === payment_hash
 */
export function validatePreimage(bolt11: string, preimage: string): boolean {
    try {
        const invoice = new Invoice({ pr: bolt11 })
        return invoice.validatePreimage(preimage)
    } catch {
        return false
    }
}

/**
 * Handle NWC (Nostr Wallet Connect) payment
 * @param bolt11 The BOLT11 invoice to pay
 * @param nwcWalletUri The NWC wallet connection URI
 * @param signer The NDK signer for NWC operations
 * @param options Additional options
 * @returns Payment result with preimage if successful
 */
export async function handleNWCPayment(
    bolt11: string,
    nwcWalletUri: string,
    signer: NDKSigner,
    options: { isZap?: boolean } = {},
): Promise<PaymentResult> {
    const nwcClient = await walletActions.getOrCreateNwcClient(nwcWalletUri, signer)
    if (!nwcClient) {
        return { success: false, error: 'Invalid NWC wallet configuration' }
    }

    try {
        const response = await nwcClient.wallet.lnPay({ pr: bolt11 })

        if (response?.preimage) {
            // Validate preimage - ensure it's a real Lightning preimage
            const isValid = validatePreimage(bolt11, response.preimage)
            if (isValid) {
                return { success: true, preimage: response.preimage }
            }
            // Invalid preimage - payment may have succeeded but preimage is fake (e.g. UUID)
            console.warn('NWC returned invalid preimage (not a real Lightning preimage)')
            return { success: true, preimage: undefined }
        }

        // No preimage returned - common with Primal wallets
        // For zaps, we'll wait for zap receipt; for non-zaps this is an error
        if (options.isZap) {
            return { success: true, preimage: undefined }
        }
        return { success: false, error: 'No preimage returned from wallet' }
    } catch (err) {
        return { success: false, error: (err as Error).message || 'NWC payment failed' }
    }
}

/**
 * Handle WebLN payment via browser extension (e.g., Alby)
 * @param bolt11 The BOLT11 invoice to pay
 * @param options Additional options
 * @returns Payment result with preimage if successful
 */
export async function handleWebLNPayment(
    bolt11: string,
    options: { isZap?: boolean } = {},
): Promise<PaymentResult> {
    if (!window.webln) {
        return { success: false, error: 'WebLN not available' }
    }

    try {
        await window.webln.enable()
        const result = await window.webln.sendPayment(bolt11)

        if (result.preimage) {
            // Validate preimage - ensure it's a real Lightning preimage
            const isValid = validatePreimage(bolt11, result.preimage)
            if (isValid) {
                return { success: true, preimage: result.preimage }
            }
            // Invalid preimage
            console.warn('WebLN returned invalid preimage (not a real Lightning preimage)')
            return { success: true, preimage: undefined }
        }

        // No preimage returned
        if (options.isZap) {
            return { success: true, preimage: undefined }
        }
        return { success: false, error: 'No preimage returned from wallet' }
    } catch (err) {
        return { success: false, error: (err as Error).message || 'WebLN payment failed' }
    }
}

/**
 * Check if WebLN is available in the browser
 */
export function hasWebLN(): boolean {
    return typeof window !== 'undefined' && !!window.webln
}
