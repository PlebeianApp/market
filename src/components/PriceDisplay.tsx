import { uiStore } from '@/lib/stores/ui'
import { useBtcExchangeRates, useCurrencyConversion } from '@/queries/external'
import { useStore } from '@tanstack/react-store'
import { isBitcoinCurrency, resolvePriceDisplay } from '@sdk/commerce/products/priceDisplay'
import { PriceDisplayView } from '@ui/components/PriceDisplayView'

interface PriceDisplayProps {
	priceValue: number
	originalCurrency: string
	className?: string
	showOriginalPrice?: boolean
	showSatsPrice?: boolean
	showRootCurrency?: boolean
}

export function PriceDisplay({ priceValue, originalCurrency = 'SATS', ...display }: PriceDisplayProps) {
	const { selectedCurrency } = useStore(uiStore)
	const { data: exchangeRates, isLoading: ratesLoading } = useBtcExchangeRates()
	const { data: satsFromFiat, isLoading: satsLoading } = useCurrencyConversion(originalCurrency, priceValue)

	const price = resolvePriceDisplay({ priceValue, originalCurrency, selectedCurrency, exchangeRates, satsFromFiat })
	const isLoading = ratesLoading || (!isBitcoinCurrency(originalCurrency) && satsLoading)

	return (
		<PriceDisplayView
			{...display}
			priceValue={priceValue}
			originalCurrency={originalCurrency}
			selectedCurrency={selectedCurrency}
			price={price}
			isLoading={isLoading}
		/>
	)
}
