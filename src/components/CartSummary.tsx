import CartItem from '@/components/CartItem'
import { ShippingSelector } from '@/components/ShippingSelector'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { Separator } from '@/components/ui/separator'
import type { RichShippingInfo } from '@/lib/stores/cart'
import { cartActions, cartStore } from '@/lib/stores/cart'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStore } from '@tanstack/react-store'
import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

interface CartSummaryProps {
	className?: string
	allowQuantityChanges?: boolean
	allowShippingChanges?: boolean
	showExpandedDetails?: boolean
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

	const [parent, enableAnimations] = useAutoAnimate()
	const [selectedShippingByUser, setSelectedShippingByUser] = useState<Record<string, string>>({})
	const [detailsExpanded, setDetailsExpanded] = useState(showExpandedDetails)

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

	useEffect(() => {
		if (Object.keys(cart.products).length > 0) {
			cartActions.groupProductsBySeller()
			cartActions.updateSellerData()
			cartActions.fetchAndSetSellerShippingOptions()
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
		enableAnimations(true)
	}, [parent, enableAnimations])

	const handleQuantityChange = (productId: string, newAmount: number) => {
		if (allowQuantityChanges) {
			cartActions.handleProductUpdate('setAmount', productId, newAmount)
		}
	}

	const handleRemoveProduct = (productId: string) => {
		if (allowQuantityChanges) {
			cartActions.handleProductUpdate('remove', productId)
		}
	}

	const handleShippingSelect = async (sellerPubkey: string, shippingOption: RichShippingInfo) => {
		if (!allowShippingChanges) return

		setSelectedShippingByUser((prev) => ({
			...prev,
			[sellerPubkey]: shippingOption.id,
		}))

		const products = productsBySeller[sellerPubkey] || []
		for (const product of products) {
			await cartActions.setShippingMethod(product.id, shippingOption)
		}
		await cartActions.updateSellerData()
	}

	return (
		<div className={`${className}`}>
			{missingShippingCount > 0 && (
				<div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
					<div className="flex">
						<div className="ml-3">
							<p className="text-sm text-yellow-700">
								Please select shipping options for {missingShippingCount} {missingShippingCount === 1 ? 'item' : 'items'} before checkout.
							</p>
						</div>
					</div>
				</div>
			)}

			<div className="space-y-8" ref={parent}>
				{Object.entries(productsBySeller).map(([sellerPubkey, products]) => {
					const data = sellerData[sellerPubkey] || {
						satsTotal: 0,
						currencyTotals: {},
						shares: { sellerAmount: 0, communityAmount: 0, sellerPercentage: 90 },
						shippingSats: 0,
					}

					const optionsForThisSeller = sellerShippingOptions[sellerPubkey] || []

					return (
						<div key={sellerPubkey} className="border-b pb-8">
							<div className="mb-4">
								<UserWithAvatar pubkey={sellerPubkey} size="sm" showBadge={false} />
							</div>

							<ul className="space-y-6">
								{products.map((product) => (
									<CartItem
										key={product.id}
										productId={product.id}
										amount={product.amount}
										onQuantityChange={allowQuantityChanges ? handleQuantityChange : () => {}}
										onRemove={allowQuantityChanges ? handleRemoveProduct : () => {}}
										hideShipping={true}
									/>
								))}
							</ul>

							{allowShippingChanges && (
								<div className="mt-4">
									<ShippingSelector
										options={optionsForThisSeller}
										selectedId={selectedShippingByUser[sellerPubkey]}
										onSelect={(option) => handleShippingSelect(sellerPubkey, option)}
										className="w-full"
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

			<div className="border-t pt-4 mt-4">
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

					<button
						className="w-full flex items-center justify-between p-2 border rounded-lg bg-gray-50"
						onClick={() => setDetailsExpanded(!detailsExpanded)}
					>
						<span className="text-sm">View Details</span>
						<ChevronDown className={`w-4 h-4 transition-transform ${detailsExpanded ? 'rotate-180' : ''}`} />
					</button>

					{detailsExpanded && (
						<div className="space-y-2 p-2 bg-gray-50 rounded-lg">
							{Object.entries(totalByCurrency).map(([currency, amount]) => (
								<div key={`total-${currency}`} className="flex justify-between">
									<p className="text-sm">Products ({currency}):</p>
									<p className="text-sm">{amount.toFixed(2)}</p>
								</div>
							))}

							{Object.entries(shippingByCurrency).map(([currency, amount]) => (
								<div key={`shipping-${currency}`} className="flex justify-between">
									<p className="text-sm">Products ({currency}):</p>
									<p className="text-sm">{amount.toFixed(2)}</p>
								</div>
							))}

							<Separator className="my-2" />
							<div className="flex justify-between">
								<p className="text-sm">Subtotal:</p>
								<p className="text-sm">{formatSats(totalInSats - totalShippingInSats)} sat</p>
							</div>

							<div className="flex justify-between">
								<p className="text-sm">Shipping:</p>
								<p className="text-sm">{formatSats(totalShippingInSats)} sat</p>
							</div>

							<Separator className="my-2" />

							<div className="flex justify-between font-semibold">
								<p className="text-sm">Grand Total:</p>
								<p className="text-sm">{formatSats(totalInSats)} sat</p>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
