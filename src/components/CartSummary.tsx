import CartItem from '@/components/CartItem'
import { ShippingSelector } from '@/components/ShippingSelector'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { Separator } from '@/components/ui/separator'
import type { RichShippingInfo } from '@/lib/stores/cart'
import { cartActions, cartStore } from '@/lib/stores/cart'
import { useStore } from '@tanstack/react-store'
import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useState, useRef, useCallback, Suspense } from 'react'

interface CartSummaryProps {
	className?: string
	allowQuantityChanges?: boolean
	allowShippingChanges?: boolean
	showExpandedDetails?: boolean
}

// Loading fallback component
function CartSummaryLoading() {
	return (
		<div className="space-y-4">
			<div className="animate-pulse">
				<div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
				<div className="h-4 bg-gray-200 rounded w-1/2"></div>
			</div>
		</div>
	)
}

export function CartSummary({
	className = '',
	allowQuantityChanges = true,
	allowShippingChanges = true,
	showExpandedDetails = false,
}: CartSummaryProps) {
	const {
		cart,
		sellerData,
		productsBySeller,
		totalInSats,
		totalShippingInSats,
		totalByCurrency,
		shippingByCurrency,
		sellerShippingOptions,
	} = useStore(cartStore)

	const [selectedShippingByUser, setSelectedShippingByUser] = useState<Record<string, string>>({})
	const [detailsExpanded, setDetailsExpanded] = useState(showExpandedDetails)
	const [isUpdating, setIsUpdating] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	const totalItems = useMemo(() => {
		return Object.values(cart.products).reduce((sum, product) => sum + product.amount, 0)
	}, [cart.products])

	const hasAllShippingMethods = useMemo(() => {
		return Object.values(cart.products).every((product) => product.shippingMethodId !== null)
	}, [cart.products])

	const missingShippingCount = useMemo(() => {
		return Object.values(cart.products).filter((product) => !product.shippingMethodId).length
	}, [cart.products])

	const formatSats = (sats: number): string => {
		return Math.round(sats).toLocaleString()
	}

	// Cleanup function for timeouts
	const clearTimeouts = useCallback(() => {
		if (animationTimeoutRef.current) {
			clearTimeout(animationTimeoutRef.current)
			animationTimeoutRef.current = null
		}
		if (updateTimeoutRef.current) {
			clearTimeout(updateTimeoutRef.current)
			updateTimeoutRef.current = null
		}
	}, [])

	useEffect(() => {
		if (Object.keys(cart.products).length > 0) {
			setIsLoading(true)
			Promise.all([
				cartActions.groupProductsBySeller(),
				cartActions.updateSellerData(),
				cartActions.fetchAndSetSellerShippingOptions()
			]).finally(() => {
				setIsLoading(false)
			})
		}

		const initialSelected: Record<string, string> = {}
		Object.values(cart.products).forEach((product) => {
			if (product.sellerPubkey && product.shippingMethodId && !initialSelected[product.sellerPubkey]) {
				initialSelected[product.sellerPubkey] = product.shippingMethodId
			}
		})
		setSelectedShippingByUser(initialSelected)
	}, [cart.products])

	useEffect(() => {
		// Cleanup on unmount
		return () => {
			clearTimeouts()
		}
	}, [clearTimeouts])

	const handleQuantityChange = useCallback((productId: string, newAmount: number) => {
		if (allowQuantityChanges && !isUpdating && !isLoading) {
			setIsUpdating(true)
			clearTimeouts()
			
			try {
				cartActions.handleProductUpdate('setAmount', productId, newAmount)
			} catch (error) {
				console.error('Error updating quantity:', error)
			}
			
			// Reset updating state after a delay
			animationTimeoutRef.current = setTimeout(() => {
				setIsUpdating(false)
			}, 300)
		}
	}, [allowQuantityChanges, isUpdating, isLoading, clearTimeouts])

	const handleRemoveProduct = useCallback((productId: string) => {
		if (allowQuantityChanges && !isUpdating && !isLoading) {
			setIsUpdating(true)
			clearTimeouts()
			
			try {
				cartActions.handleProductUpdate('remove', productId)
			} catch (error) {
				console.error('Error removing product:', error)
			}
			
			// Reset updating state after a delay
			animationTimeoutRef.current = setTimeout(() => {
				setIsUpdating(false)
			}, 300)
		}
	}, [allowQuantityChanges, isUpdating, isLoading, clearTimeouts])

	const handleShippingSelect = useCallback(async (sellerPubkey: string, shippingOption: RichShippingInfo) => {
		if (!allowShippingChanges || isUpdating || isLoading) return

		setIsUpdating(true)
		setIsLoading(true)
		clearTimeouts()

		try {
			// Update local state first
			setSelectedShippingByUser((prev) => ({
				...prev,
				[sellerPubkey]: shippingOption.id,
			}))

			// Add a small delay to allow React to process the state update
			await new Promise(resolve => setTimeout(resolve, 50))

			// Update cart state
			const products = productsBySeller[sellerPubkey] || []
			for (const product of products) {
				await cartActions.setShippingMethod(product.id, shippingOption)
			}
			
			// Add another delay before updating seller data
			await new Promise(resolve => setTimeout(resolve, 50))
			
			// Update seller data
			await cartActions.updateSellerData()
		} catch (error) {
			console.error('Error updating shipping method:', error)
			// Revert local state on error
			setSelectedShippingByUser((prev) => {
				const newState = { ...prev }
				delete newState[sellerPubkey]
				return newState
			})
		} finally {
			// Reset states after all updates are complete
			updateTimeoutRef.current = setTimeout(() => {
				setIsLoading(false)
				setIsUpdating(false)
			}, 300)
		}
	}, [allowShippingChanges, isUpdating, isLoading, clearTimeouts, productsBySeller])

	// Show loading state if updating or loading
	if (isLoading) {
		return (
			<div className={`${className}`}>
				<CartSummaryLoading />
			</div>
		)
	}

	return (
		<Suspense fallback={<CartSummaryLoading />}>
			<div className={`${className}`}>
				{missingShippingCount > 0 && (
					<div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
						<div className="flex">
							<div className="ml-3">
								<p className="text-sm text-yellow-700">
									Please select shipping for {missingShippingCount} {missingShippingCount === 1 ? 'item' : 'items'} before checkout.
								</p>
							</div>
						</div>
					</div>
				)}

				<div className="space-y-6">
					{Object.entries(productsBySeller).map(([sellerPubkey, products], sellerIndex) => {
						const data = sellerData[sellerPubkey] || {
							satsTotal: 0,
							currencyTotals: {},
							shares: { sellerAmount: 0, communityAmount: 0, sellerPercentage: 90 },
							shippingSats: 0,
						}

						const optionsForThisSeller = sellerShippingOptions[sellerPubkey] || []

						return (
							<div 
								key={sellerPubkey} 
								className="p-4 rounded-lg border shadow-md bg-white"
							>
								<div className="mb-4">
									<UserWithAvatar pubkey={sellerPubkey} size="sm" showBadge={false} />
								</div>

								<ul className="space-y-6">
									{products.map((product, index) => (
										<div
											key={product.id}
											className={`p-3 rounded-lg ${index % 2 === 0 ? 'bg-gray-100' : 'bg-white'}`}
										>
											<CartItem
												productId={product.id}
												amount={product.amount}
												onQuantityChange={allowQuantityChanges ? handleQuantityChange : () => {}}
												onRemove={allowQuantityChanges ? handleRemoveProduct : () => {}}
												hideShipping={true}
											/>
										</div>
									))}
								</ul>

								{allowShippingChanges && (
									<div className="mt-4">
										<ShippingSelector
											options={optionsForThisSeller}
											selectedId={selectedShippingByUser[sellerPubkey]}
											onSelect={(option) => handleShippingSelect(sellerPubkey, option)}
											className="w-full"
											disabled={isUpdating || isLoading}
										/>
									</div>
								)}

								{Object.entries(data.currencyTotals).map(([currency, amount]) => (
									<div key={`${sellerPubkey}-${currency}`} className="flex justify-between mt-4">
										<p className="text-sm">Products ({currency}):</p>
										<p className="text-sm">
											{amount.toFixed(2)} {currency}
										</p>
									</div>
								))}

								<div className="flex justify-between mt-1">
									<p className="text-sm">Shipping:</p>
									<p className="text-sm font-semibold">{formatSats(data.shippingSats)} sat</p>
								</div>

								<div className="flex justify-between mt-1 font-semibold">
									<p className="text-sm">Total:</p>
									<p className="text-sm">{formatSats(data.satsTotal)} sat</p>
								</div>

								<div className="mt-3">
									<p className="text-sm font-semibold">Payment Breakdown</p>

									<div className="h-2 w-full bg-gray-800 mt-1 rounded-full overflow-hidden">
										<div className="h-full bg-blue-500" style={{ width: `${data.shares.sellerPercentage}%` }} />
									</div>

									<div className="flex justify-between mt-1">
										<p className="text-sm">Merchant: </p>
										<p className="text-sm">
											{formatSats(data.shares.sellerAmount)} sat ({data.shares.sellerPercentage.toFixed(2)}%)
										</p>
									</div>

									{data.shares.communityAmount > 0 && (
										<div className="flex justify-between">
											<p className="text-sm">Community Share: </p>
											<p className="text-sm">
												{formatSats(data.shares.communityAmount)} sat ({(100 - data.shares.sellerPercentage).toFixed(2)}%)
											</p>
										</div>
									)}
								</div>
							</div>
						)
					})}
				</div>

				<div className="pt-4">
					<div className="space-y-3 w-full">
						<div className="space-y-1 mb-2">
							<div className="flex justify-between">
								<p className="text-sm">Subtotal:</p>
								<p className="text-sm">{formatSats(totalInSats - totalShippingInSats)} sat</p>
							</div>
							<div className="flex justify-between">
								<p className="text-sm">Shipping:</p>
								<p className="text-sm">{formatSats(totalShippingInSats)} sat</p>
							</div>
							<div className="flex justify-between text-lg font-bold">
								<p>Total:</p>
								<p>{formatSats(totalInSats)} sat</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</Suspense>
	)
}
