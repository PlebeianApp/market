import { configStore } from '@/lib/stores/config'
import { ndkActions } from '@/lib/stores/ndk'
import { parseNwcUri } from '@/lib/stores/wallet'
import type { PublishPaymentDetailParams } from '@/queries/payment'
import { publishPaymentDetail } from '@/queries/payment'
import { paymentDetailsKeys } from '@/queries/queryKeyFactory'
import NDK from '@nostr-dev-kit/ndk'
import { NDKNWCWallet, NDKWalletStatus } from '@nostr-dev-kit/ndk-wallet'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

/**
 * Mutation hook for publishing payment details with query invalidation
 * This wraps the query function with additional functionality
 */
export const usePublishPaymentDetailMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (params: PublishPaymentDetailParams) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			// Get app pubkey if not provided
			if (!params.appPubkey) {
				const appPubkey = configStore.state.config.appPublicKey
				if (!appPubkey) {
					throw new Error('App public key is required')
				}
				params.appPubkey = appPubkey
			}

			return publishPaymentDetail(params)
		},

		onSuccess: async (eventId, params) => {
			// Get current user pubkey
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			// Invalidate relevant queries
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byPubkey(userPubkey) })
			}

			if (params.coordinates) {
				queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byProductOrCollection(params.coordinates) })
			}

			toast.success('Payment details published successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to publish payment details:', error)
			toast.error(`Failed to publish payment details: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Helper function for creating lightning payment details
 */
export const useLightningPaymentDetailMutation = () => {
	const publishPaymentDetailMutation = usePublishPaymentDetailMutation()

	return useMutation({
		mutationFn: async (params: { lightningAddress: string; coordinates?: string; appPubkey?: string }) => {
			return publishPaymentDetailMutation.mutateAsync({
				paymentMethod: 'ln',
				paymentDetail: params.lightningAddress,
				coordinates: params.coordinates,
				appPubkey: params.appPubkey,
			})
		},

		onSuccess: (eventId) => {
			toast.success('Lightning payment details saved')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to save lightning payment details:', error)
			toast.error('Failed to save lightning payment details')
		},
	})
}

/**
 * Helper function for creating on-chain payment details
 */
export const useOnChainPaymentDetailMutation = () => {
	const publishPaymentDetailMutation = usePublishPaymentDetailMutation()

	return useMutation({
		mutationFn: async (params: { bitcoinAddress: string; coordinates?: string; appPubkey?: string }) => {
			return publishPaymentDetailMutation.mutateAsync({
				paymentMethod: 'on-chain',
				paymentDetail: params.bitcoinAddress,
				coordinates: params.coordinates,
				appPubkey: params.appPubkey,
			})
		},

		onSuccess: (eventId) => {
			toast.success('Bitcoin address saved')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to save bitcoin address:', error)
			toast.error('Failed to save bitcoin address')
		},
	})
}

export interface PayWithNwcParams {
	bolt11: string
	nwcUri: string
	userPubkey: string
	recipientPubkey: string
	invoiceId: string
	amount: number
	description: string
}

/**
 * Pays an invoice using an NWC connection via direct NIP-47 pay_invoice method
 * @returns The payment preimage on success
 */
export const payInvoiceWithNwc = async (params: PayWithNwcParams): Promise<string> => {
	const { bolt11, nwcUri, userPubkey } = params

	// Parse the NWC URI to get the relay URL
	const parsedUri = parseNwcUri(nwcUri)
	if (!parsedUri || !parsedUri.relay) {
		throw new Error('Failed to parse NWC URI or missing relay URL')
	}

	// Create a dedicated NDK instance for this specific NWC wallet
	const nwcNdk = new NDK({
		explicitRelayUrls: [parsedUri.relay],
	})

	// Set the signer from the main NDK instance
	const mainNdk = ndkActions.getNDK()
	if (!mainNdk || !mainNdk.signer) {
		throw new Error('Main NDK instance or signer not available')
	}
	nwcNdk.signer = mainNdk.signer

	// Connect to the NWC relay
	try {
		console.log('Connecting to NWC relay for payment:', parsedUri.relay)
		await nwcNdk.connect()
	} catch (error) {
		throw new Error(`Failed to connect to NWC relay: ${error}`)
	}

	const nwcWalletForPayment = new NDKNWCWallet(nwcNdk, { pairingCode: nwcUri })

	// Wait for the wallet to connect
	const timeout = 10000 // 10 seconds
	const startTime = Date.now()

	while (nwcWalletForPayment.status !== NDKWalletStatus.READY) {
		if (Date.now() - startTime > timeout) {
			throw new Error('NWC wallet connection timeout')
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}

	console.log(`Initiating NWC pay_invoice request for ${params.amount} sats`)

	try {
		// Create the NIP-47 pay_invoice request payload
		const nwcRequest = {
			method: 'pay_invoice',
			params: {
				invoice: bolt11,
			},
		}

		// Send the NWC request using the wallet's lnPay method
		const response = await nwcWalletForPayment.lnPay({
			pr: bolt11,
		})

		if (!response || !response.preimage) {
			throw new Error('Payment succeeded but no preimage was returned')
		}

		console.log(`✅ NWC payment successful, preimage: ${response.preimage.substring(0, 16)}...`)
		return response.preimage
	} catch (error) {
		console.error('❌ NWC payment failed:', error)
		throw new Error(`NWC payment failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
	} finally {
		// Disconnect the NWC NDK instance
		try {
			await nwcNdk.disconnect()
		} catch (e) {
			// Ignore cleanup errors
		}
	}
}

/**
 * Initiates a payment using a WebLN-compatible browser extension (e.g., Alby).
 * @param bolt11 The BOLT11 payment request string.
 * @returns A promise that resolves with the payment preimage if successful.
 * @throws If WebLN is not available or the payment fails.
 */
export const payInvoiceWithWebln = async (bolt11: string): Promise<string> => {
	if (!window.webln) {
		throw new Error('WebLN not available. Please install a WebLN-compatible wallet extension.')
	}

	await window.webln.enable()
	const result = await window.webln.sendPayment(bolt11)

	if (!result?.preimage) {
		throw new Error('Payment failed or was cancelled. No preimage received.')
	}

	return result.preimage
}

/**
 * Parameters for publishing a payment receipt
 */
export interface PublishPaymentReceiptParams {
	invoice: {
		orderId: string
		recipientPubkey?: string
		amount: number
		description?: string
		id: string
		bolt11?: string
		paymentMethod?: 'ln' | 'on-chain'
	}
	// Lightning payment fields
	preimage?: string
	bolt11?: string
	// On-chain payment fields
	txid?: string
	bitcoinAddress?: string
}

/**
 * Publishes a payment receipt (Kind 17) to the Nostr network
 * This creates a proof of payment for the order
 */
export const publishPaymentReceipt = async (params: PublishPaymentReceiptParams): Promise<string> => {
	const { invoice, preimage, bolt11, txid, bitcoinAddress } = params

	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No signer available')

	// Get current user
	const user = await signer.user()
	if (!user) throw new Error('No user available')

	// Create the payment receipt event (Kind 17)
	const event = new (await import('@nostr-dev-kit/ndk')).NDKEvent(ndk)
	event.kind = 17 // Payment Receipt Kind
	event.content = invoice.description || 'Payment confirmation'

	const isOnChain = invoice.paymentMethod === 'on-chain'

	// Build payment tag based on payment method
	let paymentTag: string[]
	if (isOnChain && txid && bitcoinAddress) {
		// On-chain payment: ['payment', 'bitcoin', address, txid]
		paymentTag = ['payment', 'bitcoin', bitcoinAddress, txid]
	} else if (!isOnChain && bolt11 && preimage) {
		// Lightning payment: ['payment', 'lightning', bolt11, preimage]
		paymentTag = ['payment', 'lightning', bolt11, preimage]
	} else {
		throw new Error('Invalid payment parameters: missing required fields for payment method')
	}

	const tags = [
		['p', invoice.recipientPubkey || ''], // Merchant's pubkey
		['subject', 'order-receipt'],
		['order', invoice.orderId],
		paymentTag, // Payment proof
		['amount', invoice.amount.toString()],
	]

	event.tags = tags
	event.created_at = Math.floor(Date.now() / 1000)

	try {
		await event.sign(signer)
		await event.publish()

		console.log(`✅ Payment receipt published for order ${invoice.orderId} (${isOnChain ? 'on-chain' : 'lightning'})`)
		return event.id
	} catch (error) {
		console.error('❌ Failed to publish payment receipt:', error)
		throw new Error(`Failed to publish payment receipt: ${error instanceof Error ? error.message : 'Unknown error'}`)
	}
}
