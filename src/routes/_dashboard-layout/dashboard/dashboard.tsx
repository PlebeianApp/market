import { createFileRoute, Link } from '@tanstack/react-router'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { OrderActions } from '@/components/orders/OrderActions'
import { getStatusStyles } from '@/lib/utils/orderUtils'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { dashboardStore, getLayoutWidgets } from '@/lib/stores/dashboard'
import UplotReact from 'uplot-react'
import 'uplot/dist/uPlot.min.css'
import { cn } from '@/lib/utils'
import { useOrders } from '@/queries/orders'
import { getOrderStatus, formatSats, getEventDate, getOrderAmount, getOrderId } from '@/queries/orders'
import { ORDER_STATUS } from '@/lib/schemas/order'
import { useConversationsList } from '@/queries/messages'
import { postsQueryOptions } from '@/queries/posts'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { productsQueryOptions, getProductTitle, getProductImages, getProductPrice } from '@/queries/products'

// Wireframe Loader Components
function SalesOverviewLoader() {
	return (
		<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
			<CardHeader className="px-4 py-2">
				<div className="flex items-center justify-between gap-3">
					<div className="h-6 w-16 bg-gray-200 rounded animate-pulse"></div>
					<div className="h-8 w-40 bg-gray-200 rounded animate-pulse"></div>
				</div>
			</CardHeader>
			<CardContent className="flex-1 min-h-0 overflow-y-auto px-4">
				<div className="mt-2 space-y-3">
					{Array.from({ length: 4 }).map((_, i) => (
						<div key={i} className="flex items-center justify-between rounded border border-gray-200 p-3 bg-gray-50">
							<div className="flex items-center gap-3">
								<div className="h-8 w-8 bg-gray-200 rounded animate-pulse"></div>
								<div className="space-y-2">
									<div className="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
									<div className="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<div className="h-5 w-28 bg-gray-200 rounded animate-pulse"></div>
								<div className="h-8 w-8 bg-gray-200 rounded animate-pulse"></div>
							</div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	)
}

function TopProductsLoader() {
	return (
		<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
			<CardHeader className="px-4 py-4">
				<div className="flex items-center justify-between">
					<div className="h-6 w-24 bg-gray-200 rounded animate-pulse"></div>
					<div className="h-4 w-16 bg-gray-200 rounded animate-pulse"></div>
				</div>
			</CardHeader>
			<CardContent className="flex-1 min-h-0 overflow-y-auto px-4">
				<div className="space-y-3">
					{Array.from({ length: 5 }).map((_, i) => (
						<div key={i} className="flex items-center gap-3 p-3 border border-gray-200 rounded bg-gray-50">
							<div className="h-12 w-12 bg-gray-200 rounded animate-pulse flex-shrink-0"></div>
							<div className="flex-1 space-y-2">
								<div className="h-4 w-32 bg-gray-200 rounded animate-pulse"></div>
								<div className="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
							</div>
							<div className="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	)
}

function SalesChartLoader() {
	return (
		<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
			<CardHeader className="p-4">
				<div className="flex items-center justify-between gap-3">
					<div className="h-6 w-20 bg-gray-200 rounded animate-pulse"></div>
					<div className="h-8 w-40 bg-gray-200 rounded animate-pulse"></div>
				</div>
			</CardHeader>
			<CardContent className="flex-1 min-h-0 overflow-hidden px-4 pb-4">
				<div className="mt-1 h-full">
					<div className="relative h-full rounded border border-gray-200 bg-gray-50 px-0 flex items-center justify-center">
						<div className="space-y-3">
							<div className="h-32 w-48 bg-gray-200 rounded animate-pulse"></div>
							<div className="h-4 w-24 bg-gray-200 rounded animate-pulse mx-auto"></div>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}

function LatestMessagesLoader() {
	return (
		<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
			<CardHeader className="px-4 py-4">
				<div className="flex items-center justify-between">
					<div className="h-6 w-28 bg-gray-200 rounded animate-pulse"></div>
					<div className="h-4 w-12 bg-gray-200 rounded animate-pulse"></div>
				</div>
			</CardHeader>
			<CardContent className="flex-1 min-h-0 overflow-y-auto px-4">
				<div className="space-y-3">
					{Array.from({ length: 4 }).map((_, i) => (
						<div key={i} className="flex items-center justify-between p-3 border border-gray-200 rounded bg-gray-50">
							<div className="space-y-2">
								<div className="h-4 w-24 bg-gray-200 rounded animate-pulse"></div>
								<div className="h-3 w-32 bg-gray-200 rounded animate-pulse"></div>
							</div>
							<div className="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	)
}

function NostrPostsLoader() {
	return (
		<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
			<CardHeader className="px-4 py-4">
				<div className="flex items-center justify-between">
					<div className="h-6 w-32 bg-gray-200 rounded animate-pulse"></div>
					<div className="h-4 w-12 bg-gray-200 rounded animate-pulse"></div>
				</div>
			</CardHeader>
			<CardContent className="flex-1 min-h-0 overflow-y-auto px-4">
				<div className="space-y-3">
					{Array.from({ length: 5 }).map((_, i) => (
						<div key={i} className="p-3 border border-gray-200 rounded bg-gray-50 space-y-2">
							<div className="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
							<div className="space-y-1">
								<div className="h-3 w-full bg-gray-200 rounded animate-pulse"></div>
								<div className="h-3 w-3/4 bg-gray-200 rounded animate-pulse"></div>
								<div className="h-3 w-1/2 bg-gray-200 rounded animate-pulse"></div>
							</div>
							<div className="h-3 w-24 bg-gray-200 rounded animate-pulse"></div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	)
}

export const Route = createFileRoute('/_dashboard-layout/dashboard/dashboard')({
	component: DashboardInnerComponent,
})

function DashboardInnerComponent() {
	useDashboardTitle('Dashboard')
	const { data: orders = [], isLoading: ordersLoading } = useOrders()
	const { data: conversations = [], isLoading: conversationsLoading } = useConversationsList()
	const { data: posts = [], isLoading: postsLoading } = useQuery(postsQueryOptions)
	const { data: products = [], isLoading: productsLoading } = useQuery(productsQueryOptions)
	const { user } = useStore(authStore)
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm' || breakpoint === 'md' || breakpoint === 'lg'

	// Check if any data is still loading
	const isLoading = ordersLoading || conversationsLoading || postsLoading || productsLoading

	const [salesTab, setSalesTab] = React.useState<'all' | keyof typeof ORDER_STATUS>('all')
	const [showAllMobileSales, setShowAllMobileSales] = React.useState(false)

	const salesByStatus = React.useMemo(() => {
		const counts: Record<string, number> = { all: orders.length }
		for (const key of Object.values(ORDER_STATUS)) counts[key] = 0
		orders.forEach((o) => {
			const s = getOrderStatus(o)
			counts[s] = (counts[s] ?? 0) + 1
		})
		return counts
	}, [orders])

	const filteredOrders = React.useMemo(() => {
		if (salesTab === 'all') return orders
		return orders.filter((o) => getOrderStatus(o) === salesTab)
	}, [orders, salesTab])

	const visibleOrders = React.useMemo(() => {
		if (!filteredOrders) return []
		if (!isMobile || showAllMobileSales) return filteredOrders
		return filteredOrders.slice(-4)
	}, [filteredOrders, isMobile, showAllMobileSales])

	const topProducts = React.useMemo(() => {
		if (!products || products.length === 0) return []
		return [...products]
			.sort((a, b) => ((b?.created_at || 0) - (a?.created_at || 0)))
			.slice(0, 5)
	}, [products])

	// Placeholder chart data
	const chartData = React.useMemo(() => {
		if (orders.length === 0) return null
		return [
			[0, 1, 2, 3, 4, 5, 6],
			[1, 3, 2, 5, 4, 6, 7]
		]
	}, [orders])

	const chartOptions = React.useMemo(() => ({
		title: undefined,
		width: 400,
		height: 200,
		series: [
			{},
			{
				label: 'Sales',
				stroke: '#ff2ebd',
				width: 2,
				points: { size: 4 },
				spanGaps: true,
			},
		],
	}), [])

	// Lock body scroll while dashboard is mounted (prevents page scroll when data loads)
	React.useEffect(() => {
		if (typeof window === 'undefined' || typeof document === 'undefined') return
		const prev = document.body.style.overflow
		const isDesktop = window.matchMedia('(min-width: 1024px)').matches
		if (isDesktop) document.body.style.overflow = 'hidden'
		return () => {
			document.body.style.overflow = prev
		}
	}, [])

	const dashboardState = useStore(dashboardStore)
	const layoutWidgets = getLayoutWidgets(dashboardState)
	
	// Calculate smart column spans based on widget placement
	const getGridColSpans = () => {
		const hasTopLeft = !!layoutWidgets.topLeft
		const hasTopRight = !!layoutWidgets.topRight
		const hasBottomLeft = !!layoutWidgets.bottomLeft
		const hasBottomRight = !!layoutWidgets.bottomRight
		const hasRight = !!layoutWidgets.right
		
		return {
			// If no right column widget, main grid takes full width
			mainCols: hasRight ? 'lg:col-span-2' : 'lg:col-span-3',
			// If only one widget in a row, it takes full width of that row
			topLeftSpan: hasTopRight ? 'lg:col-span-1' : 'lg:col-span-2',
			topRightSpan: hasTopLeft ? 'lg:col-span-1' : 'lg:col-span-2',
			bottomLeftSpan: hasBottomRight ? 'lg:col-span-1' : 'lg:col-span-2',
			bottomRightSpan: hasBottomLeft ? 'lg:col-span-1' : 'lg:col-span-2',
		}
	}
	
	const colSpans = getGridColSpans()

	// Widget component renderer
	const renderWidget = (widget: typeof layoutWidgets.topLeft, spanClass?: string) => {
		if (!widget || !widget.id || !widget.component) return null
		
		const baseClasses = cn(spanClass, "min-h-0 h-full")
		
		switch (widget.component) {
			case 'SalesOverview':
				return (
					<div key={widget.id} className={baseClasses}>
						{isLoading ? (
							<SalesOverviewLoader />
						) : (
							<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
								<CardHeader className="px-4 py-3">
									<CardTitle className="flex items-center justify-between gap-3">
										<span>Sales</span>
										<div className="flex items-center gap-2">
											<Select value={salesTab} onValueChange={(v) => setSalesTab(v as any)}>
												<SelectTrigger className="w-40">
													<SelectValue placeholder="All statuses" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="all">All ({salesByStatus['all'] ?? 0})</SelectItem>
													{Object.values(ORDER_STATUS).map((key) => (
														<SelectItem key={key} value={key}>
															<span className="capitalize">{key}</span> ({salesByStatus[key] ?? 0})
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</CardTitle>
								</CardHeader>
								<CardContent className="flex-1 min-h-0 overflow-y-auto px-4">
									<div className="mt-2 space-y-3">
										{visibleOrders.map((o, index) => {
											const orderId = getOrderId(o.order) || o.order?.id || `order-${index}`
											const amount = formatSats(getOrderAmount(o.order))
											const date = getEventDate(o.order)
											const status = getOrderStatus(o)
											const { bgColor, textColor } = getStatusStyles(o)
											return (
												<div key={orderId} className="flex items-center justify-between rounded border border-black p-3 fg-layer-overlay hover:bg-layer-overlay">
													<Link
														to="/dashboard/orders/$orderId"
														params={{ orderId }}
														search={{ from: 'dashboard' } as any}
														className="flex min-w-0 items-center gap-3"
													>
														<div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs font-mono">{(orderId && typeof orderId === 'string' ? orderId.slice(0, 4) : '????')}</div>
														<div className="min-w-0">
															<div className="text-sm font-medium truncate">{amount}</div>
															<div className="text-xs text-muted-foreground truncate">{date}</div>
														</div>
													</Link>
													<div className="flex items-center gap-2 flex-shrink-0">
														<span className={cn('text-xs capitalize rounded px-2 py-0.5 border w-28 text-center', bgColor, textColor)}>{status}</span>
														{user?.pubkey && (
															<OrderActions order={o} userPubkey={user.pubkey} variant="ghost" className="h-8 w-8 p-0" showStatusBadge={false} />
														)}
													</div>
												</div>
											)
										})}
										{!ordersLoading && orders.length === 0 && (
											<div className="text-sm text-muted-foreground">No sales yet.</div>
										)}
										{isMobile && filteredOrders.length > 4 && (
											<div className="pt-2">
												<Button className="w-full bg-black text-white hover:bg-black/90" onClick={() => setShowAllMobileSales((v) => !v)}>
													{showAllMobileSales ? 'View less' : 'View all'}
												</Button>
											</div>
										)}
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				)
			
			case 'TopProducts':
				return (
					<div key={widget.id} className={baseClasses}>
						{isLoading ? (
							<TopProductsLoader />
						) : (
							<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
								<CardHeader className="px-4 py-3">
									<CardTitle className="flex items-center justify-between">
										<span>Top Products</span>
										<Link to="/dashboard/products/products" className="text-sm text-muted-foreground hover:text-pink-500 transition-colors">
											View All
										</Link>
									</CardTitle>
								</CardHeader>
								<CardContent className="flex-1 min-h-0 overflow-y-auto px-4">
									<div className="space-y-3">
										{productsLoading ? (
											<div className="text-sm text-muted-foreground">Loading products...</div>
										) : products.length === 0 ? (
											<div className="text-sm text-muted-foreground">No products found.</div>
										) : (
											topProducts.map((product, index) => {
												if (!product?.id) return null
												const images = getProductImages(product)
												const imageUrl = images?.[0]?.[1]
												const title = getProductTitle(product)
												const price = getProductPrice(product)
												return (
													<div key={product.id || `product-${index}`} className="flex items-center justify-between rounded border border-black p-3 fg-layer-overlay hover:bg-layer-overlay">
														<Link
															to="/products/$productId"
															params={{ productId: product.id }}
															className="flex min-w-0 items-center gap-3"
														>
															<div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs font-mono overflow-hidden">
																{imageUrl ? (
																	<img src={imageUrl} alt={title} className="h-full w-full object-cover" />
																) : (
																	(title && typeof title === 'string' ? title.slice(0, 2) : '??')
																)}
															</div>
															<div className="min-w-0">
																<div className="text-sm font-medium truncate">{title}</div>
																<div className="text-xs text-muted-foreground truncate">{price ? `${formatSats(price)}` : 'No price'}</div>
															</div>
														</Link>
													</div>
												)
											})
										)}
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				)
			
			case 'SalesChart':
				return (
					<div key={widget.id} className={baseClasses}>
						{isLoading ? (
							<SalesChartLoader />
						) : (
							<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
								<CardHeader className="px-4 py-3">
									<CardTitle>Sales Chart</CardTitle>
								</CardHeader>
								<CardContent className="flex-1 min-h-0 overflow-y-auto px-4">
									<div className="h-full flex items-center justify-center">
										{chartData ? (
											<UplotReact options={chartOptions} data={chartData} />
										) : (
											<div className="text-sm text-muted-foreground">No sales data available</div>
										)}
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				)
			
			case 'LatestMessages':
				return (
					<div key={widget.id} className={baseClasses}>
						{isLoading ? (
							<LatestMessagesLoader />
						) : (
							<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
								<CardHeader className="px-4 py-3">
									<CardTitle className="flex items-center justify-between">
										<span>Latest Messages</span>
										<Link to="/dashboard/sales/messages" className="text-sm text-muted-foreground hover:text-pink-500 transition-colors">
											View All
										</Link>
									</CardTitle>
								</CardHeader>
								<CardContent className="flex-1 min-h-0 overflow-y-auto px-4">
									<div className="space-y-3">
										{conversationsLoading ? (
											<div className="text-sm text-muted-foreground">Loading conversations...</div>
										) : conversations.length === 0 ? (
											<div className="text-sm text-muted-foreground">No messages yet.</div>
										) : (
											(conversations || []).slice(0, 4).map((conv, index) => {
												if (!conv?.pubkey) return null
												return (
													<div key={conv.pubkey || `conv-${index}`} className="flex items-center justify-between rounded border border-black p-3 fg-layer-overlay hover:bg-layer-overlay">
														<Link
														to="/dashboard/sales/messages/$pubkey"
														params={{ pubkey: conv.pubkey }}
														search={{ from: 'dashboard' } as any}
														className="flex min-w-0 items-center gap-3"
													>
														<div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs font-mono">
															{conv.profile?.picture ? (
																<img src={conv.profile.picture} alt={conv.profile.name} className="h-full w-full object-cover rounded" />
															) : (
																((conv.profile?.name || conv.pubkey) && typeof (conv.profile?.name || conv.pubkey) === 'string' ? (conv.profile?.name || conv.pubkey).slice(0, 2) : '??')
															)}
														</div>
														<div className="min-w-0">
															<div className="text-sm font-medium truncate">{conv.profile?.name || conv.profile?.displayName || `${(conv.pubkey && typeof conv.pubkey === 'string' ? conv.pubkey.slice(0, 8) : 'Unknown')}...`}</div>
															<div className="text-xs text-muted-foreground truncate">{conv.lastMessage?.content || 'No messages'}</div>
														</div>
													</Link>
													<div className="flex items-center gap-2">
														<svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
															<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
														</svg>
													</div>
												</div>
												)
											})
										)}
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				)
			
			case 'NostrPosts':
				return (
					<div key={widget.id} className={baseClasses}>
						{isLoading ? (
							<NostrPostsLoader />
						) : (
							<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
								<CardHeader className="px-4 py-3">
									<CardTitle className="flex items-center justify-between">
										<span>Nostr Posts</span>
										<Link to="/posts" className="text-sm text-muted-foreground hover:text-pink-500 transition-colors">
											View All
										</Link>
									</CardTitle>
								</CardHeader>
								<CardContent className="flex-1 min-h-0 overflow-y-auto px-4">
									<div className="space-y-3">
										{postsLoading ? (
											<div className="text-sm text-muted-foreground">Loading posts...</div>
										) : posts.length === 0 ? (
											<div className="text-sm text-muted-foreground">No posts found.</div>
										) : (
											(posts || []).slice(0, 6).map((post, index) => {
												if (!post?.id) return null
												return (
													<div key={post.id || `post-${index}`} className="rounded border border-black p-3 fg-layer-overlay hover:bg-layer-overlay">
														<Link
														to="/posts/$postId"
														params={{ postId: post.id }}
														className="block"
													>
														<div className="text-sm truncate mb-1">{post.content}</div>
														<div className="text-xs text-muted-foreground">
															{post.author?.profile?.name || `${(post.pubkey && typeof post.pubkey === 'string' ? post.pubkey.slice(0, 8) : 'Unknown')}...`} • {post.created_at ? new Date(post.created_at * 1000).toLocaleDateString() : 'Unknown date'}
														</div>
													</Link>
												</div>
												)
											})
										)}
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				)
			
			default:
				return null
		}
	}

	return (
		<div className="h-full min-h-0 flex flex-col overflow-hidden">
			{/* Dynamic Layout based on widget configuration */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0 overflow-hidden">
				{/* Main grid area */}
				<div className={cn(colSpans.mainCols, "grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-2 gap-4 min-h-0")}>
					{/* Top Row */}
					{renderWidget(layoutWidgets.topLeft, colSpans.topLeftSpan)}
					{renderWidget(layoutWidgets.topRight, colSpans.topRightSpan)}
					
					{/* Bottom Row */}
					{renderWidget(layoutWidgets.bottomLeft, colSpans.bottomLeftSpan)}
					{renderWidget(layoutWidgets.bottomRight, colSpans.bottomRightSpan)}
				</div>

				{/* Right Column */}
				{layoutWidgets.right && (
					<div className="min-h-0 h-full">
						{renderWidget(layoutWidgets.right)}
					</div>
				)}
			</div>
		</div>
	)
}