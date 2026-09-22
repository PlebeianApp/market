/**
 * `PriceDisplay` — renders a validated price, or says it could not.
 *
 * Two rules that come from the spec rather than from taste:
 *
 *   - **No conversion.** Converting to sats or fiat needs a rate source, which is RUNTIME-ONLY
 *     (browsing spec §4). The component renders the currency the publisher stated.
 *   - **An absent price is named, not hidden.** Since a missing `price` is tolerated by the parser
 *     (decision D8), the card must be honest that the listing states no price — otherwise a listing
 *     with no price looks like one that is free.
 */
import type { ProductPrice } from '@plebeian/product-event'

export interface PriceDisplayProps {
	price: ProductPrice | undefined
	/** Optional host-supplied formatting; when absent the raw published form is shown. */
	format?: (price: ProductPrice) => string
	className?: string
}

export const formatPrice = (price: ProductPrice): string => {
	const amount = price.amount
	const currency = price.currency
	// A frequency means a subscription; ISO 8601 unit letters are spelled out for readability only.
	const frequency = price.frequency ? ` / ${price.frequency}` : ''
	return `${amount} ${currency}${frequency}`
}

export const PriceDisplay = ({ price, format, className }: PriceDisplayProps) => {
	if (!price) {
		return <span className={`pb-card__price--absent ${className ?? ''}`}>No price stated</span>
	}
	return <span className={`pb-card__price ${className ?? ''}`}>{format ? format(price) : formatPrice(price)}</span>
}
