import { uiStore } from '@/lib/stores/ui'
import { useBtcExchangeRates, useCurrencyConversion } from '@/queries/external'
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
	/** Whether to show the root currency indicator (default: false) */
	showRootCurrency?: boolean
}

export function PriceDisplay({
	priceValue,
	originalCurrency = 'SATS',
	className = '',
	showOriginalPrice = true,
	showSatsPrice = true,
	showRootCurrency = false,
}: PriceDisplayProps) {
	const { selectedCurrency } = useStore(uiStore)

	// Get BTC exchange rates for currency conversion
	const { data: exchangeRates, isLoading: ratesLoading } = useBtcExchangeRates()

	// Convert the original price to sats (for fiat currencies)
	const { data: satsFromFiat, isLoading: satsLoading } = useCurrencyConversion(originalCurrency, priceValue)

	// Determine if the original currency is Bitcoin-based
	const isBitcoinCurrency = ['SATS', 'BTC', 'sats', 'btc'].includes(originalCurrency.toUpperCase())

	// Calculate sats value based on root currency type
	const getSatsValue = (): number | null => {
		if (isBitcoinCurrency) {
			// If root currency is Bitcoin-based, convert to sats
			if (originalCurrency.toUpperCase() === 'SATS') {
				return priceValue
			} else if (originalCurrency.toUpperCase() === 'BTC') {
				return Math.round(priceValue * 100000000) // Convert BTC to sats
			}
		} else {
			// If root currency is fiat, use the converted sats value
			return satsFromFiat || null
		}
		return null
	}

	// Calculate fiat value from sats
	const getFiatValue = (satsValue: number): { value: number; currency: string } | null => {
		if (!exchangeRates || !satsValue) return null

		const btcAmount = satsValue / 100000000 // Convert sats to BTC
		const targetCurrency = isBitcoinCurrency ? selectedCurrency : originalCurrency
		const rate = exchangeRates[targetCurrency as keyof typeof exchangeRates]

		if (rate) {
			return {
				value: btcAmount * rate,
				currency: targetCurrency,
			}
		}
		return null
	}

	const satsValue = getSatsValue()
	const fiatValue = satsValue ? getFiatValue(satsValue) : null
	const isLoading = ratesLoading || (!isBitcoinCurrency && satsLoading)

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
			{/* Root currency indicator */}
			{showRootCurrency && (
				<div className="flex items-center gap-2 mb-1">
					<span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Listed in {originalCurrency}</span>
					<div className="h-1 w-1 bg-gray-400 rounded-full"></div>
					<span className="text-xs text-gray-400">{isBitcoinCurrency ? 'Bitcoin' : `Fiat currency: ${selectedCurrency}`}</span>
				</div>
			)}

			{/* Sats price - more prominent */}
			{showSatsPrice && satsValue && <p className="text-md font-bold">{Math.round(satsValue).toLocaleString()} sats</p>}

			{/* Secondary price (fiat when root is Bitcoin, or original when root is fiat) */}
			{showOriginalPrice && (
				<p className="text-sm text-gray-400">
					{isBitcoinCurrency
						? // Root is Bitcoin, show converted fiat
							fiatValue
							? `${fiatValue.value.toLocaleString(undefined, {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								})} ${fiatValue.currency}`
							: `${priceValue.toLocaleString(undefined, {
									minimumFractionDigits: originalCurrency.toLowerCase() === 'btc' ? 8 : 0,
									maximumFractionDigits: originalCurrency.toLowerCase() === 'btc' ? 8 : 0,
								})} ${originalCurrency}`
						: // Root is fiat, show original fiat price
							`${priceValue.toLocaleString(undefined, {
								minimumFractionDigits: 2,
								maximumFractionDigits: 2,
							})} ${originalCurrency}`}
				</p>
			)}
		</div>
	)
}
