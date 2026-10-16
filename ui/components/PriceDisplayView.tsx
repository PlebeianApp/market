import type { PriceDisplayResolution } from '@sdk/commerce/products/priceDisplay'

export interface PriceDisplayViewProps {
	priceValue: number
	originalCurrency: string
	selectedCurrency: string
	price: PriceDisplayResolution
	isLoading: boolean
	className?: string
	showOriginalPrice?: boolean
	showSatsPrice?: boolean
	showRootCurrency?: boolean
}

const twoDecimals = { minimumFractionDigits: 2, maximumFractionDigits: 2 }

function formatSecondaryPrice(priceValue: number, originalCurrency: string, price: PriceDisplayResolution): string {
	if (!price.isBitcoinCurrency) return `${priceValue.toLocaleString(undefined, twoDecimals)} ${originalCurrency}`
	if (price.fiatValue) return `${price.fiatValue.value.toLocaleString(undefined, twoDecimals)} ${price.fiatValue.currency}`
	const digits = originalCurrency.toLowerCase() === 'btc' ? 8 : 0
	return `${priceValue.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${originalCurrency}`
}

export function PriceDisplayView({
	priceValue,
	originalCurrency,
	selectedCurrency,
	price,
	isLoading,
	className = '',
	showOriginalPrice = true,
	showSatsPrice = true,
	showRootCurrency = false,
}: PriceDisplayViewProps) {
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
			{showRootCurrency && (
				<div className="flex items-center gap-2 mb-1">
					<span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Listed in {originalCurrency}</span>
					<div className="h-1 w-1 bg-gray-400 rounded-full"></div>
					<span className="text-xs text-gray-400">{price.isBitcoinCurrency ? 'Bitcoin' : `Fiat currency: ${selectedCurrency}`}</span>
				</div>
			)}

			{showSatsPrice && price.satsValue && <p className="text-md font-bold">{Math.round(price.satsValue).toLocaleString()} sats</p>}

			{showOriginalPrice && <p className="text-sm text-gray-400">{formatSecondaryPrice(priceValue, originalCurrency, price)}</p>}
		</div>
	)
}
