import { ProductCard } from '@/components/ProductCard'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { OrderActions } from '@/components/orders/OrderActions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { authStore } from '@/lib/stores/auth'
import {
	formatSats,
	getBuyerPubkey,
	getEventDate,
	getOrderAmount,
	getOrderId,
	getOrderStatus,
	getSellerPubkey,
	useOrderById,
} from '@/queries/orders'
import { productsByPubkeyQueryOptions } from '@/queries/products'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueries } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { CreditCard, MessageSquare, Package, Receipt, Truck } from 'lucide-react'
import { useMemo } from 'react'

interface OrderDetailComponentProps {
	orderId: string
}

export function OrderDetailComponent({ orderId }: OrderDetailComponentProps) {
	// Accept orderId as a prop
	const { user } = useStore(authStore)
	const { data: orderData, isLoading, error } = useOrderById(orderId)

	// ✅ Ensure all hooks are always run
	const orderItems = useMemo(() => {
		return orderData?.order?.tags?.filter((tag) => tag[0] === 'item') || []
	}, [orderData?.order?.tags])

	const productReferences = useMemo(() => {
		return orderItems
			.map((tag) => {
				const productRef = tag[1] // Format: "30402:pubkey:d-tag"
				const quantity = parseInt(tag[2] || '1')
				const [kind, pubkey, dTag] = productRef.split(':')
				return { productRef, quantity, pubkey, dTag }
			})
			.filter((item) => item.pubkey) // Only include valid references
	}, [orderItems])

	const uniquePubkeys = useMemo(() => {
		const pubkeySet = new Set(productReferences.map((item) => item.pubkey).filter(Boolean))
		return Array.from(pubkeySet)
	}, [productReferences])

	const queries = useMemo(() => {
		return uniquePubkeys.length > 0
			? uniquePubkeys.map((pubkey) => ({
					...productsByPubkeyQueryOptions(pubkey),
					enabled: !!pubkey && !!orderData,
				}))
			: []
	}, [uniquePubkeys, orderData])

	const productQueries = useQueries({
		queries,
	})

	const allProducts = productQueries.flatMap((query) => query.data || [])

	const orderProducts = useMemo(() => {
		return productReferences.map((item) => {
			const product = allProducts.find((p) => {
				const productDTag = p.tags.find((tag) => tag[0] === 'd')?.[1]
				return p.pubkey === item.pubkey && productDTag === item.dTag
			})
			return {
				...item,
				product,
			}
		})
	}, [productReferences, allProducts])



	return (
		<div className="space-y-6">
			{isLoading ? (
				<div className="space-y-6">
					<div className="bg-white rounded-md shadow-sm p-6">
						<p className="text-gray-500">Loading order details...</p>
					</div>
				</div>
			) : error || !orderData ? (
				<div className="space-y-6">
					<div className="bg-white rounded-md shadow-sm p-6">
						<p className="text-gray-600">The order you're looking for doesn't exist or you don't have access to it.</p>
					</div>
				</div>
			) : (
				(() => {
					// Now that isLoading, error, and !orderData are handled, we can safely use orderData
					const order = orderData.order
					const currentOrderId = getOrderId(order)
					const status = getOrderStatus(orderData)
					const amount = getOrderAmount(order)
					const buyerPubkey = getBuyerPubkey(order)
					const sellerPubkey = getSellerPubkey(order)
					const orderDate = getEventDate(order)

					const isBuyer = user?.pubkey === buyerPubkey
					const isSeller = user?.pubkey === sellerPubkey

					const renderEventCard = (event: NDKEvent, title: string, icon: React.ReactNode, type: string) => {
						const eventDate = new Date((event.created_at || 0) * 1000).toLocaleString()
						let content = event.content
						let extraInfo = null

						if (type === 'status') {
							const statusTag = event.tags.find((tag) => tag[0] === 'status')
							if (statusTag) {
								extraInfo = <Badge variant="outline">{statusTag[1].charAt(0).toUpperCase() + statusTag[1].slice(1)}</Badge>
							}
						} else if (type === 'shipping') {
							const statusTag = event.tags.find((tag) => tag[0] === 'status')
							const trackingTag = event.tags.find((tag) => tag[0] === 'tracking')
							const carrierTag = event.tags.find((tag) => tag[0] === 'carrier')

							extraInfo = (
								<div className="space-y-2">
									{statusTag && <Badge variant="outline">Status: {statusTag[1]}</Badge>}
									{trackingTag && (
										<div className="text-sm">
											<strong>Tracking:</strong> {trackingTag[1]}
										</div>
									)}
									{carrierTag && (
										<div className="text-sm">
											<strong>Carrier:</strong> {carrierTag[1]}
										</div>
									)}
								</div>
							)
						} else if (type === 'payment') {
							const paymentTags = event.tags.filter((tag) => tag[0] === 'payment')
							const amountTag = event.tags.find((tag) => tag[0] === 'amount')

							extraInfo = (
								<div className="space-y-2">
									{amountTag && (
										<div className="text-sm">
											<strong>Amount:</strong> {formatSats(amountTag[1])}
										</div>
									)}
									{paymentTags.map((tag, idx) => (
										<Badge key={idx} variant="outline">
											{tag[1]}: {tag[2] ? `${tag[2].substring(0, 20)}...` : 'Verified'}
										</Badge>
									))}
								</div>
							)
						}

						return (
							<Card key={event.id}>
								<CardHeader className="pb-3">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											{icon}
											<CardTitle className="text-lg">{title}</CardTitle>
										</div>
										<span className="text-sm text-gray-500">{eventDate}</span>
									</div>
									{extraInfo && <div className="mt-2">{extraInfo}</div>}
								</CardHeader>
								{content && (
									<CardContent className="pt-0">
										<p className="text-gray-700">{content}</p>
									</CardContent>
								)}
							</Card>
						)
					}

					const allEvents = [
						...orderData.statusUpdates.map((event) => ({
							event,
							type: 'status',
							title: 'Status Update',
							icon: <Package className="w-5 h-5" />,
						})),
						...orderData.shippingUpdates.map((event) => ({
							event,
							type: 'shipping',
							title: 'Shipping Update',
							icon: <Truck className="w-5 h-5" />,
						})),
						...orderData.paymentRequests.map((event) => ({
							event,
							type: 'payment_request',
							title: 'Payment Request',
							icon: <CreditCard className="w-5 h-5" />,
						})),
						...orderData.paymentReceipts.map((event) => ({
							event,
							type: 'payment',
							title: 'Payment Receipt',
							icon: <Receipt className="w-5 h-5" />,
						})),
						...orderData.generalMessages.map((event) => ({
							event,
							type: 'message',
							title: 'Message',
							icon: <MessageSquare className="w-5 h-5" />,
						})),
					].sort((a, b) => (b.event.created_at || 0) - (a.event.created_at || 0))

					return (
						<>
							<Card>
								<CardHeader>
									<CardTitle>Order #{currentOrderId?.substring(0, 8)}...</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<div>
											<h4 className="font-medium text-gray-900">Order Information</h4>
											<div className="mt-2 space-y-1 text-sm text-gray-600">
												<div>Order ID: {currentOrderId}</div>
												<div>Amount: {formatSats(amount)}</div>
												<div>Date: {orderDate}</div>
												<div>Role: {isBuyer ? 'Buyer' : isSeller ? 'Seller' : 'Observer'}</div>
											</div>
										</div>
										<div>
											<h4 className="font-medium text-gray-900">Participants</h4>
											<div className="mt-2 space-y-2">
												{buyerPubkey && (
													<div className="flex items-center gap-2">
														<span className="text-sm text-gray-600 w-12">Buyer:</span>
														<UserWithAvatar pubkey={buyerPubkey} showBadge={false} size="sm" />
													</div>
												)}
												{sellerPubkey && (
													<div className="flex items-center gap-2">
														<span className="text-sm text-gray-600 w-12">Seller:</span>
														<UserWithAvatar pubkey={sellerPubkey} showBadge={false} size="sm" />
													</div>
												)}
											</div>
										</div>
									</div>

									{user?.pubkey && (isBuyer || isSeller) && (
										<>
											<Separator />
											<div className="flex justify-center">
												<OrderActions order={orderData} userPubkey={user.pubkey} />
											</div>
										</>
									)}
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle>Order Details</CardTitle>
								</CardHeader>
								<CardContent>
									<p className="text-gray-700">{order.content || 'No order description provided.'}</p>
								</CardContent>
							</Card>

							{orderProducts.length > 0 && (
								<Card>
									<CardHeader>
										<CardTitle>Items Ordered</CardTitle>
									</CardHeader>
									<CardContent>
										<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
											{orderProducts.map((item, idx) => (
												<div key={idx} className="relative">
													{item.product ? (
														<>
															<ProductCard product={item.product} />
															{item.quantity > 1 && (
																<div className="absolute top-2 right-2 bg-blue-600 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
																	{item.quantity}
																</div>
															)}
														</>
													) : (
														<div className="border border-gray-300 rounded-lg p-4 text-center">
															<div className="text-gray-500 text-sm">Product not found</div>
															<div className="text-xs text-gray-400 mt-1">{item.productRef}</div>
															<div className="text-sm font-medium mt-2">Qty: {item.quantity}</div>
														</div>
													)}
												</div>
											))}
										</div>
									</CardContent>
								</Card>
							)}

							{allEvents.length > 0 && (
								<div>
									<h2 className="text-xl font-bold mb-4">Order Timeline</h2>
									<div className="space-y-4">
										{allEvents.map(({ event, type, title, icon }) => renderEventCard(event, title, icon, type))}
									</div>
								</div>
							)}

							{allEvents.length === 0 && (
								<Card>
									<CardContent className="py-8 text-center">
										<p className="text-gray-500">No additional order events yet.</p>
									</CardContent>
								</Card>
							)}
						</>
					)
				})()
			)}
		</div>
	)
}
