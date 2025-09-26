import { useCurrencyConversion, useBtcExchangeRates } from '@/queries/external'
import { uiStore } from '@/lib/stores/ui'
import { useStore } from '@tanstack/react-store'

interface PriceDisplayProps {
	/** The price value as a number */
	priceValue: number
	/** The original currency of the price */
	originalCurrency: string
	/** Optional className for styling */
	className?: string
	/** Whether to show the original currency price (default: true) */
	showOriginalPrice?: boolean
	/** Whether to show the sats price (default: true) */
	showSatsPrice?: boolean
}

export function PriceDisplay({
	priceValue,
	originalCurrency,
	className = '',
	showOriginalPrice = true,
	showSatsPrice = true,
}: PriceDisplayProps) {
	const { selectedCurrency } = useStore(uiStore)

	// Convert the original price to sats
	const { data: satsPrice, isLoading: satsLoading } = useCurrencyConversion(originalCurrency, priceValue)

	// Get BTC exchange rates for currency conversion
	const { data: exchangeRates, isLoading: ratesLoading } = useBtcExchangeRates()

	// Calculate the display price in the selected currency
	const getDisplayPrice = () => {
		if (originalCurrency.toLowerCase() === selectedCurrency.toLowerCase()) {
			// If original currency matches selected currency, show original price
			return { value: priceValue, currency: originalCurrency }
		} else if (selectedCurrency.toLowerCase() === 'sats' && satsPrice) {
			// If selected currency is sats, show sats price
			return { value: satsPrice, currency: 'SATS' }
		} else if (satsPrice && exchangeRates && selectedCurrency !== 'SATS') {
			// Convert from sats to selected currency via BTC
			const btcAmount = satsPrice / 100000000 // Convert sats to BTC
			const selectedCurrencyRate = exchangeRates[selectedCurrency as keyof typeof exchangeRates]
			if (selectedCurrencyRate) {
				const convertedValue = btcAmount * selectedCurrencyRate
				return { value: convertedValue, currency: selectedCurrency }
			}
		}

		// Fallback to original price
		return { value: priceValue, currency: originalCurrency }
	}

	const displayPrice = getDisplayPrice()
	const isLoading = satsLoading || ratesLoading

	if (isLoading) {
		return (
			<div className={`flex flex-col gap-1 ${className}`}>
				<div className="animate-pulse bg-gray-200 h-4 w-16 rounded"></div>
				<div className="animate-pulse bg-gray-200 h-3 w-12 rounded"></div>
			</div>
		)
	}

	return (
		<div className={`flex flex-col gap-1 ${className}`}>
			{/* Sats price - more prominent */}
			{showSatsPrice && satsPrice && <p className="text-md font-bold">{Math.round(satsPrice).toLocaleString()} sats</p>}

			{/* Original or converted price */}
			{showOriginalPrice && (
				<p className="text-sm text-gray-400">
					{displayPrice.value.toLocaleString(undefined, {
						minimumFractionDigits: originalCurrency.toLowerCase() === 'btc' ? 8 : 2,
						maximumFractionDigits: originalCurrency.toLowerCase() === 'btc' ? 8 : 2,
					})}{' '}
					{displayPrice.currency}
				</p>
			)}
		</div>
	)
}
