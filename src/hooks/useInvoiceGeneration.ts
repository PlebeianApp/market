import { useState, useCallback } from 'react'
import { LightningService } from '@/lib/utils/lightning'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import type { LightningInvoiceData } from '@/components/checkout/InvoicePaymentComponent'

interface UseInvoiceGenerationProps {
	fallbackToMock?: boolean
}

interface InvoiceGenerationResult {
	generateInvoiceForSeller: (
		sellerPubkey: string,
		amount: number,
		description: string,
		invoiceId: string,
		items: Array<{
			productId: string
			name: string
			amount: number
			price: number
		}>,
		invoiceType?: 'seller' | 'v4v',
	) => Promise<LightningInvoiceData>
	isGenerating: boolean
	error: string | null
}

export function useInvoiceGeneration({ fallbackToMock = true }: UseInvoiceGenerationProps = {}): InvoiceGenerationResult {
	const [isGenerating, setIsGenerating] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const generateInvoiceForSeller = useCallback(
		async (
			sellerPubkey: string,
			amount: number,
			description: string,
			invoiceId: string,
			items: Array<{
				productId: string
				name: string
				amount: number
				price: number
			}>,
			invoiceType: 'seller' | 'v4v' = 'seller',
		): Promise<LightningInvoiceData> => {
			setIsGenerating(true)
			setError(null)

			try {
				// Fetch seller's profile to get Lightning address
				const profile = await fetchProfileByIdentifier(sellerPubkey)
				const lightningAddress = profile?.lud16 || profile?.lud06

				let bolt11: string
				let expiresAt: number
				let sellerName = profile?.name || profile?.displayName || `Seller ${sellerPubkey.substring(0, 8)}...`

				if (lightningAddress && LightningService.isValidLightningAddress(lightningAddress)) {
					console.log(`Generating real Lightning invoice for ${lightningAddress}`)
					try {
						// Try to generate a real Lightning invoice with enhanced features
						const invoiceResult = await LightningService.generateInvoiceFromLightningAddress(lightningAddress, amount, description, {
							enableNostr: true, // Enable Nostr zap support if available
						})
						bolt11 = invoiceResult.bolt11
						expiresAt = invoiceResult.expiresAt

						// If the service provides a verification URL, we could use it for payment tracking
						if (invoiceResult.verifyUrl) {
							console.log(`Payment verification available for ${sellerName}`)
						}

						if (invoiceResult.allowsNostr) {
							console.log(`Nostr zap support available for ${sellerName}`)
						}
					} catch (lightningError) {
						console.warn('Failed to generate real Lightning invoice, falling back to mock:', lightningError)

						if (fallbackToMock) {
							const mockResult = LightningService.generateMockInvoice(amount, description)
							bolt11 = mockResult.bolt11
							expiresAt = mockResult.expiresAt
						} else {
							throw lightningError
						}
					}
				} else {
					console.log('No valid Lightning address found, using mock invoice')

					if (fallbackToMock) {
						const mockResult = LightningService.generateMockInvoice(amount, description)
						bolt11 = mockResult.bolt11
						expiresAt = mockResult.expiresAt
					} else {
						throw new Error('No valid Lightning address found for seller')
					}
				}

				// Create payment methods for the invoice
				const paymentMethods = [
					{
						type: 'lightning' as const,
						details: bolt11,
						label: 'Lightning Network',
					},
					{
						type: 'bitcoin' as const,
						details: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', // Mock on-chain address
						label: 'Bitcoin On-chain',
					},
				]

				const lightningInvoice: LightningInvoiceData = {
					id: invoiceId,
					sellerPubkey,
					sellerName,
					amount,
					bolt11,
					expiresAt,
					items,
					status: 'pending',
					invoiceType,
					paymentMethods,
				}

				console.log(`Generated invoice for ${sellerName}:`, {
					amount,
					expiresAt: new Date(expiresAt * 1000),
					hasRealInvoice: !!lightningAddress,
				})

				return lightningInvoice
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : 'Failed to generate invoice'
				setError(errorMessage)
				console.error('Invoice generation failed:', err)
				throw err
			} finally {
				setIsGenerating(false)
			}
		},
		[fallbackToMock],
	)

	return {
		generateInvoiceForSeller,
		isGenerating,
		error,
	}
}
