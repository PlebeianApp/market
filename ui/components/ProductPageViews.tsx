import { AlertTriangle, Edit, Minus, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Input } from '../primitives/input'
import { UiLink } from '../provider/UiProvider'

const BACK_TO_PRODUCTS = '/products'

function BackToProductsLink() {
	return (
		<UiLink href={BACK_TO_PRODUCTS} className="inline-flex">
			<Button variant="outline">Back to products</Button>
		</UiLink>
	)
}

export function ProductLoadingState() {
	return (
		<div className="flex h-[50vh] flex-col items-center justify-center gap-3 px-4 text-center">
			<div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
			<p className="text-muted-foreground">Loading product…</p>
		</div>
	)
}

export function ProductLoadErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div className="flex h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
			<h1 className="text-2xl font-bold">Still loading product</h1>
			<p className="text-gray-600">{message}</p>
			<div className="flex flex-wrap items-center justify-center gap-2">
				<Button variant="secondary" onClick={onRetry}>
					Retry
				</Button>
				<BackToProductsLink />
			</div>
		</div>
	)
}

export function ProductNotFoundState() {
	return (
		<div className="flex h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
			<h1 className="text-2xl font-bold">Product Not Found</h1>
			<p className="text-gray-600">The product you're looking for doesn't exist (or hasn't propagated to relays yet).</p>
			<BackToProductsLink />
		</div>
	)
}

export function AdultContentGate({ onEnable }: { onEnable: () => void }) {
	return (
		<div className="flex h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
			<AlertTriangle className="h-16 w-16 text-amber-500" />
			<h1 className="text-2xl font-bold">Adult Content</h1>
			<p className="max-w-md text-gray-600">
				This product contains adult or sensitive content. To view it, you need to enable adult content viewing in your settings.
			</p>
			<div className="flex gap-3">
				<BackToProductsLink />
				<Button onClick={onEnable} className="bg-amber-600 hover:bg-amber-700">
					Enable adult content
				</Button>
			</div>
		</div>
	)
}

export type ProductPageVisibility = 'on-sale' | 'pre-order' | 'hidden' | (string & {})

export interface ProductPurchasePanelProps {
	visibility: ProductPageVisibility
	stock: number | undefined
	productType?: { product: string; delivery: string } | null
	quantity: number
	onQuantityChange: (quantity: number) => void
	isOutOfStock: boolean
	canAddToCart: boolean
	canEdit: boolean
	onAddToCart: () => void
	onEdit: () => void
	/** Host-rendered notice shown under the stock badge (e.g. curation labels). */
	notice?: ReactNode
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

function addToCartLabel(visibility: ProductPageVisibility, isOutOfStock: boolean): string {
	if (visibility === 'hidden') return 'Not Available'
	if (isOutOfStock) return 'Out of Stock'
	if (visibility === 'pre-order') return 'Pre-order'
	return 'Add to cart'
}

/** Stock, product type, and cart/edit controls. Cart mutation and navigation stay with the host. */
export function ProductPurchasePanel({
	visibility,
	stock,
	productType,
	quantity,
	onQuantityChange,
	isOutOfStock,
	canAddToCart,
	canEdit,
	onAddToCart,
	onEdit,
	notice,
}: ProductPurchasePanelProps) {
	const showType = productType?.product === 'simple' || productType?.product === 'variable'

	return (
		<>
			{visibility === 'pre-order' ? (
				<Badge className="bg-blue-500">Pre-order</Badge>
			) : (
				<Badge>{stock !== undefined ? `${stock} in stock` : 'Out of stock'}</Badge>
			)}

			{notice}

			{showType && productType && (
				<div>
					{capitalize(productType.product)} / {capitalize(productType.delivery)}
				</div>
			)}

			{stock !== undefined && (
				<div className="flex items-center gap-4">
					{canAddToCart && (
						<div className="flex flex-wrap items-center gap-2">
							<div className="flex flex-shrink-0 items-center gap-2">
								<Button
									variant="outline"
									className="text-foreground"
									size="icon"
									onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
									disabled={quantity <= 1}
									aria-label="Decrease quantity"
								>
									<Minus className="h-6 w-6" />
								</Button>
								<Input
									className="w-12 bg-white text-center font-medium text-black"
									value={quantity}
									onChange={(event) => {
										const value = parseInt(event.target.value)
										if (!isNaN(value) && value > 0 && value <= (stock || Infinity)) onQuantityChange(value)
									}}
									min={1}
									max={stock}
									type="number"
									aria-label="Quantity"
								/>
								<Button
									variant="outline"
									className="text-foreground"
									size="icon"
									onClick={() => onQuantityChange(Math.min(stock || quantity + 1, quantity + 1))}
									disabled={quantity >= (stock || quantity)}
									aria-label="Increase quantity"
								>
									<Plus className="h-6 w-6" />
								</Button>
							</div>
							<Button variant="secondary" onClick={onAddToCart} disabled={isOutOfStock || visibility === 'hidden'}>
								{addToCartLabel(visibility, isOutOfStock)}
							</Button>
						</div>
					)}
					{canEdit && (
						<Button variant="secondary" onClick={onEdit} className="flex items-center gap-2">
							<Edit className="h-5 w-5" />
							<span>Edit Product</span>
						</Button>
					)}
				</div>
			)}
		</>
	)
}
