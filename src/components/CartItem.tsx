import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
	getProductImages,
	getProductPrice,
	getProductShippingOptions,
	getProductStock,
	getProductTitle,
	isNSFWProduct,
	productSelectionQueryOptions,
} from '@/queries/products'
import { Skeleton } from '@/components/ui/skeleton'
import { ShippingSelector } from '@/components/ShippingSelector'
import { createShippingReference, getShippingInfo, useShippingOptionsByPubkey } from '@/queries/shipping'
import type { RichShippingInfo } from '@/lib/stores/cart'
import { cartActions, cartStore } from '@/lib/stores/cart'
import { normalizePublishedProductShippingTags, resolvePublishedProductShippingOptions } from '@/lib/utils/productShippingSelections'
import { useQuery } from '@tanstack/react-query'
import { PriceDisplay } from '@/components/PriceDisplay'
import {
	getProductSelectionContext,
	getProductSelectionImages,
	getProductSelectionTags,
	isProductSelectionValidForCartItem,
} from '@/queries/productFamilies'
import { uiStore } from '@/lib/stores/ui'
import { useStore } from '@tanstack/react-store'

interface CartItemProps {
	productId: string
	sellerPubkey: string
	amount: number
	onQuantityChange: (productId: string, newAmount: number) => void
	onRemove: (productId: string) => void
	hideShipping?: boolean
	isEditable?: boolean
}

export default function CartItem({
	productId,
	sellerPubkey,
	amount,
	onQuantityChange,
	onRemove,
	hideShipping = false,
	isEditable = true,
}: CartItemProps) {
	const [quantity, setQuantity] = useState(amount)

	// Keep the selected child as the cart identity and price/stock source, while
	// resolving its exact same-author parent for image and shipping fallback.
	const productSelectionQuery = useQuery(productSelectionQueryOptions(productId, sellerPubkey))
	const selectedProduct = productSelectionQuery.data?.selected ?? null
	const productSelectionUnavailable =
		productSelectionQuery.isError ||
		(productSelectionQuery.isSuccess &&
			(!productSelectionQuery.data || !isProductSelectionValidForCartItem(productSelectionQuery.data, productId, sellerPubkey)))
	const parentProduct =
		productSelectionUnavailable || !productSelectionQuery.data ? null : getProductSelectionContext(productSelectionQuery.data)
	const title = getProductTitle(selectedProduct)
	const priceTag = getProductPrice(selectedProduct)
	const { showNSFWContent } = useStore(uiStore)
	const isNSFW = isNSFWProduct(parentProduct) || isNSFWProduct(selectedProduct)
	const images =
		productSelectionUnavailable || (isNSFW && !showNSFWContent)
			? []
			: parentProduct
				? getProductSelectionImages(parentProduct, selectedProduct)
				: getProductImages(selectedProduct)
	const stockTag = getProductStock(selectedProduct)
	const sellerShippingOptionsQuery = useShippingOptionsByPubkey(sellerPubkey)

	const isLoading = productSelectionQuery.isLoading

	// Parse data
	const price = priceTag ? parseFloat(priceTag[1]) : 0
	const currency = priceTag ? priceTag[2] : 'USD'
	const stockQuantity = stockTag && /^\d+$/.test(stockTag[1]) ? Number(stockTag[1]) : undefined
	const subtotal = price * amount

	// Get current shipping method
	const currentShippingId = cartActions.getShippingMethod(productId)
	const hasShipping = Boolean(currentShippingId)

	useEffect(() => {
		if (productSelectionUnavailable && currentShippingId) {
			void cartActions.setShippingMethod(productId, {})
		}
	}, [currentShippingId, productId, productSelectionUnavailable])

	const sellerShippingOptions = useMemo<RichShippingInfo[]>(() => {
		if (!sellerShippingOptionsQuery.data || !sellerPubkey) return []

		return sellerShippingOptionsQuery.data.flatMap((event) => {
			const info = getShippingInfo(event)
			if (!info || !info.id || typeof info.id !== 'string' || info.id.trim().length === 0) return []

			return [
				{
					id: createShippingReference(sellerPubkey, info.id),
					name: info.title,
					cost: parseFloat(info.price.amount),
					currency: info.price.currency,
					countries: info.countries,
					service: info.service,
					carrier: info.carrier,
				},
			]
		})
	}, [sellerPubkey, sellerShippingOptionsQuery.data])

	const productShippingSelections = useMemo(
		() =>
			normalizePublishedProductShippingTags(
				parentProduct
					? getProductSelectionTags(parentProduct, selectedProduct, 'shipping_option')
					: getProductShippingOptions(selectedProduct),
			),
		[parentProduct, selectedProduct],
	)

	const productShippingOptions = useMemo(
		() =>
			resolvePublishedProductShippingOptions({
				publishedSelections: productShippingSelections,
				availableOptions: sellerShippingOptions,
			}),
		[productShippingSelections, sellerShippingOptions],
	)

	const selectedShippingOption = useMemo(() => {
		if (!currentShippingId) return null
		return productShippingOptions.find((option) => option.shippingRef === currentShippingId || option.id === currentShippingId) ?? null
	}, [currentShippingId, productShippingOptions])

	const hasResolvedSellerShippingState = sellerShippingOptionsQuery.isSuccess || sellerShippingOptionsQuery.data !== undefined
	const isShippingOptionsLoading =
		productSelectionQuery.isLoading || (productShippingSelections.length > 0 && !hasResolvedSellerShippingState)
	const isShippingOptionsUnavailable =
		productSelectionUnavailable || (!hasResolvedSellerShippingState && sellerShippingOptionsQuery.isError)

	// Handle quantity input change
	const handleQuantityChange = (value: string) => {
		if (!isEditable) return
		const newQuantity = parseInt(value)
		if (!isNaN(newQuantity)) {
			setQuantity(newQuantity)
		}
	}

	// Handle quantity blur to update cart
	const handleQuantityBlur = () => {
		if (!isEditable) return
		if (quantity !== amount) {
			onQuantityChange(productId, quantity)
		}
	}

	// Handle immediate button-based quantity changes
	const handleIncrementClick = () => {
		if (!isEditable) return
		const newAmount = stockQuantity === undefined ? amount + 1 : Math.min(amount + 1, stockQuantity)
		if (newAmount !== amount) {
			onQuantityChange(productId, newAmount)
		}
	}

	const handleDecrementClick = () => {
		if (!isEditable) return
		const newAmount = Math.max(1, amount - 1)
		if (newAmount !== amount) {
			onQuantityChange(productId, newAmount)
		}
	}

	// Update local state when prop changes
	useEffect(() => {
		setQuantity(amount)
	}, [amount])

	const formatShippingCost = (cost: number | null | undefined): string => {
		return typeof cost === 'number' && Number.isFinite(cost) ? cost.toLocaleString() : ''
	}

	const formatShippingAmount = (cost: number | null | undefined, shippingCurrency?: string | null): string => {
		return [formatShippingCost(cost), shippingCurrency?.trim()].filter(Boolean).join(' ')
	}

	const cartSelectedShipping = (() => {
		const product = cartStore.state.cart.products[productId]
		if (!product || typeof product.shippingCost !== 'number' || !Number.isFinite(product.shippingCost)) return null
		return {
			cost: product.shippingCost,
			currency: product.shippingCostCurrency,
		}
	})()

	const selectedShippingCost = selectedShippingOption
		? {
				cost: selectedShippingOption.cost,
				currency: selectedShippingOption.currency,
			}
		: cartSelectedShipping

	const selectedShippingCostText = selectedShippingCost
		? formatShippingAmount(selectedShippingCost.cost, selectedShippingCost.currency)
		: ''
	const hasAdditiveShippingMetadata =
		selectedShippingOption && Number.isFinite(selectedShippingOption.baseCost) && Number.isFinite(selectedShippingOption.extraCostAmount)
	const selectedShippingBreakdownText =
		hasAdditiveShippingMetadata && selectedShippingOption.extraCostAmount !== 0
			? `${formatShippingAmount(selectedShippingOption.baseCost, selectedShippingOption.currency)} base cost + ${formatShippingAmount(
					selectedShippingOption.extraCostAmount,
					selectedShippingOption.currency,
				)} product cost`
			: ''

	if (isLoading) {
		return (
			<li className="flex gap-4 pb-4 border-b border-gray-300 [.bg-gray-100_&]:border-white">
				<Skeleton className="h-20 w-20 rounded-md" />
				<div className="flex flex-1 flex-col justify-between">
					<div>
						<Skeleton className="h-5 w-24 mb-1" />
						<Skeleton className="h-4 w-16" />
					</div>
					<div className="flex items-center justify-between mt-2">
						<div className="flex items-center space-x-2">
							<Skeleton className="h-8 w-8 rounded" />
							<Skeleton className="h-8 w-12 rounded" />
							<Skeleton className="h-8 w-8 rounded" />
						</div>
					</div>
				</div>
				<Skeleton className="h-5 w-16 self-center" />
			</li>
		)
	}

	if (productSelectionUnavailable) {
		return (
			<li className="flex items-center justify-between gap-4 py-4 border-b border-red-200" data-testid="cart-product-parent-unavailable">
				<div>
					<h3 className="font-medium text-red-700">Product option unavailable</h3>
					<p className="text-sm text-muted-foreground">
						The parent listing needed to verify this option was not returned. Remove it from the cart before checkout.
					</p>
				</div>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
					onClick={() => {
						if (isEditable) onRemove(productId)
					}}
					disabled={!isEditable}
					aria-label="Remove unavailable product"
				>
					<Trash2 size={16} />
				</Button>
			</li>
		)
	}

	return (
		<li className="flex flex-col py-4 border-b border-gray-300 [.bg-gray-100_&]:border-white">
			<div className="flex flex-col sm:flex-row sm:items-center gap-4">
				{/* Product Image */}
				{images && images.length > 0 ? (
					<div className="h-16 w-16 sm:h-20 sm:w-20 flex-shrink-0 rounded-md border overflow-hidden">
						<img
							src={images[0][1]}
							alt={title || 'Product image'}
							className="h-full w-full object-cover object-center"
							style={{ maxWidth: '100%', maxHeight: '100%' }}
						/>
					</div>
				) : (
					<div className="h-16 w-16 sm:h-20 sm:w-20 flex-shrink-0 rounded-md border bg-gray-100 flex items-center justify-center text-gray-400 overflow-hidden">
						<span className="text-xs text-center px-1 leading-tight" style={{ lineHeight: '1.1' }}>
							{title ? title.split(' ').slice(0, 2).join(' ') : 'No image'}
						</span>
					</div>
				)}

				{/* Product Details */}
				<div className="flex flex-1 flex-col justify-between">
					<div>
						<h3 className="text-base font-medium">{title || 'Untitled Product'}</h3>
						<div className="mt-1">
							<PriceDisplay priceValue={price} originalCurrency={currency} showOriginalPrice={true} showSatsPrice={true} />
						</div>
					</div>

					{/* Quantity Controls */}
					<div className="flex items-center mt-2">
						<div className="flex items-center space-x-2">
							<Button
								variant="outline"
								size="icon"
								className="h-8 w-8"
								onClick={handleDecrementClick}
								disabled={!isEditable || amount <= 1}
							>
								<Minus size={14} />
							</Button>

							<Input
								type="number"
								className="w-12 h-8 text-center p-0"
								value={quantity}
								onChange={(e) => handleQuantityChange(e.target.value)}
								onBlur={handleQuantityBlur}
								min={1}
								max={stockQuantity}
								disabled={!isEditable}
							/>

							<Button
								variant="outline"
								size="icon"
								className="h-8 w-8"
								onClick={handleIncrementClick}
								disabled={!isEditable || (stockQuantity !== undefined && amount >= stockQuantity)}
							>
								<Plus size={14} />
							</Button>
						</div>

						{/* Delete Button */}
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 sm:self-center sm:ml-auto self-start"
							onClick={() => {
								if (!isEditable) return
								onRemove(productId)
							}}
							disabled={!isEditable}
						>
							<Trash2 size={16} />
						</Button>
					</div>
				</div>

				{/* Product Total removed per new design */}
			</div>

			{/* Shipping Section - only show if not hidden */}
			{!hideShipping && (
				<div className="sm:ml-24 ml-0 mt-3 flex flex-col gap-2">
					{isShippingOptionsLoading ? (
						<div className="text-sm text-muted-foreground">Loading shipping options...</div>
					) : isShippingOptionsUnavailable ? (
						<div className="text-sm text-red-500">Shipping options unavailable</div>
					) : (
						<ShippingSelector
							productId={productId}
							options={productShippingOptions}
							selectedId={currentShippingId ?? undefined}
							className="w-full max-w-xs"
							onSelect={() => {}} // No-op since ShippingSelector updates cart when productId is provided
						/>
					)}

					{!hasShipping && <div className="text-sm font-medium text-red-600">Select a shipping option before continuing.</div>}

					{hasShipping && selectedShippingCostText && (
						<div className="text-sm text-muted-foreground">Shipping cost: {selectedShippingCostText}</div>
					)}

					{selectedShippingBreakdownText && <div className="text-xs text-muted-foreground">{selectedShippingBreakdownText}</div>}
				</div>
			)}
		</li>
	)
}
