import { createFileRoute, Link } from '@tanstack/react-router'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { OrderActions } from '@/components/orders/OrderActions'
import { getStatusStyles } from '@/lib/utils/orderUtils'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { dashboardStore, dashboardActions } from '@/lib/stores/dashboard'
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
import { productsQueryOptions, productsByPubkeyQueryOptions, getProductTitle, getProductImages, getProductPrice, getProductStock, getProductCategories } from '@/queries/products'
import { useNwcWalletBalanceQuery } from '@/queries/wallet'
import { ndkStore } from '@/lib/stores/ndk'

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

function LowStockLoader() {
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
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 bg-gray-200 rounded animate-pulse"></div>
                                <div className="space-y-2">
                                    <div className="h-4 w-28 bg-gray-200 rounded animate-pulse"></div>
                                    <div className="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
                                </div>
                            </div>
                            <div className="h-3 w-10 bg-gray-200 rounded animate-pulse"></div>
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
	const { data: myProducts = [], isLoading: myProductsLoading } = useQuery({
		...productsByPubkeyQueryOptions(user?.pubkey || ''),
		enabled: !!user?.pubkey,
	})
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm' || breakpoint === 'md' || breakpoint === 'lg'

	// Check if any data is still loading
	const isLoading = ordersLoading || conversationsLoading || postsLoading || productsLoading

	// Wallet balance (NWC) - subscribe to ndk store so changes trigger re-render
	const ndkState = useStore(ndkStore)
	const activeNwcUri = ndkState.activeNwcWalletUri || undefined
	const { data: nwcBalance } = useNwcWalletBalanceQuery(activeNwcUri, !!activeNwcUri)

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

	// Sales graph time range
	const [salesRange, setSalesRange] = React.useState<'today' | 'week' | 'month' | 'year' | 'all'>('all')

	// Posts pagination
	const [visiblePostsCount, setVisiblePostsCount] = React.useState(20)

	const isWithinRange = React.useCallback(
		(tsSeconds?: number | null) => {
			if (!tsSeconds) return false
			if (salesRange === 'all') return true
			const ts = tsSeconds * 1000
			const now = Date.now()
			const day = 24 * 60 * 60 * 1000
			switch (salesRange) {
				case 'today':
					return ts > now - day
				case 'week':
					return ts > now - 7 * day
				case 'month':
					return ts > now - 30 * day
				case 'year':
					return ts > now - 365 * day
				default:
					return true
			}
		},
		[salesRange]
	)

	const salesSeries = React.useMemo(() => {
		const filteredOrders = orders.filter((o) => isWithinRange(o.order.created_at))
		if (filteredOrders.length === 0) return []

		// Group by day
		const dayGroups: Record<string, number> = {}
		filteredOrders.forEach((o) => {
			const ts = o.order.created_at
			if (!ts) return
			const dayKey = new Date(ts * 1000).toDateString()
			dayGroups[dayKey] = (dayGroups[dayKey] || 0) + 1
		})

		const sorted = Object.entries(dayGroups).sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
		return sorted.map(([day, count], index) => ({
			label: new Date(day).toLocaleDateString(),
			value: count,
			index: index
		}))
	}, [orders, isWithinRange])

	// Chart container refs and dimensions for proper uPlot sizing
	const chartContainerRef = React.useRef<HTMLDivElement>(null)
	const [chartWidth, setChartWidth] = React.useState(300)
	const [chartHeight, setChartHeight] = React.useState(180)
	const [tooltip, setTooltip] = React.useState({ show: false, left: 0, top: 0, value: '', label: '' })
	const lastCursorUpdateRef = React.useRef(0)

	React.useEffect(() => {
		if (!chartContainerRef.current) return
		const el = chartContainerRef.current
		const ro = new ResizeObserver(() => {
			const w = Math.max(200, el.clientWidth)
			const measured = Math.max(150, el.clientHeight)
			const fallbackH = Math.max(200, Math.round(w * 0.5))
			const h = measured > 0 ? measured : fallbackH
			setChartWidth(w)
			setChartHeight(h)
		})
		ro.observe(el)
		const initW = Math.max(200, el.clientWidth)
		const initialMeasured = Math.max(150, el.clientHeight)
		const initFallbackH = Math.max(200, Math.round(initW * 0.5))
		setChartWidth(initW)
		setChartHeight(initialMeasured > 0 ? initialMeasured : initFallbackH)
		return () => ro.disconnect()
	}, [])

	const uplotData = React.useMemo(() => {
		if (salesSeries.length === 0) return [[0, 1], [0, 0]]
		return [
			salesSeries.map((_, i) => i),
			salesSeries.map(s => s.value)
		]
	}, [salesSeries])

	const uplotOpts = React.useMemo(() => {
		const gridColor = 'rgba(0,0,0,0.15)'
		return {
			title: undefined,
			hooks: {
				setCursor: [
					(u: any) => {
						const now = performance.now()
						if (now - lastCursorUpdateRef.current < 30) return
						lastCursorUpdateRef.current = now
						const idx = u.cursor.idx
						if (idx == null || idx < 0 || !salesSeries[idx]) {
							setTooltip((t) => ({ ...t, show: false }))
							return
						}
						const xPx = u.cursor.left
						const yVal = u.data[1][idx]
						const yPx = u.cursor.top
						const left = u.bbox.left + xPx
						const top = u.bbox.top + yPx
						setTooltip({ show: true, left, top, label: salesSeries[idx].label, value: yVal })
					},
				],
			},
			width: 300, // overridden by measured container width
			height: 180, // overridden by measured container height
			// Adjusted padding: [top, right, bottom, left]
			padding: [8, 10, 8, 10],
			scales: { x: { time: false }, y: { auto: true } },
			axes: [
				// Bottom X axis without labels (hide labels for clarity on mobile)
				{
					grid: { show: true, stroke: gridColor },
					gap: 2,
					size: 16,
					values: () => [],
				},
				// Left Y axis with labels
				{
					side: 3,
					grid: { show: true, stroke: gridColor },
					gap: 2,
					size: 36,
					values: (u: any, splits: number[]) => splits.map((v) => (Number.isInteger(v) ? String(v) : '')),
				},
				// Top axis (no labels) to mirror bottom gutter
				{
					side: 0,
					size: 28,
					grid: { show: false },
					ticks: { show: false },
					values: () => [],
				},
				// Right axis (no labels) to mirror left gutter
				{
					side: 1,
					size: 36,
					grid: { show: false },
					ticks: { show: false },
					values: () => [],
				},
			],
			legend: { show: false },
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
		}
	}, [salesSeries])

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
	const layoutWidgets = {
		top: dashboardActions.getLayoutWidgets('top'),
		bottom: dashboardActions.getLayoutWidgets('bottom'),
		right: dashboardActions.getLayoutWidgets('right'),
		hidden: dashboardActions.getLayoutWidgets('hidden')
	}
	
	// Widget component renderer
	const renderWidget = (widget: any, spanClass?: string) => {
		if (!widget || !widget.id || !widget.component) return null
		
		const baseClasses = cn(spanClass, "min-h-0 h-full")
		
		switch (widget.component) {
			case 'Payments':
				return (
					<div key={widget.id} className={baseClasses}>
						<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
							<CardHeader className="px-4 py-4">
								<CardTitle className="flex items-center justify-between">
									<span>Payments</span>
									<span className="text-sm text-muted-foreground">{nwcBalance ? `${nwcBalance.balance.toLocaleString()} sats` : '—'}</span>
								</CardTitle>
							</CardHeader>
							<CardContent className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
								<div className="space-y-3 h-full">
									{(() => {
										const receipts = orders
											.flatMap((o) => o.paymentReceipts || [])
											.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
											.slice(0, 8)

										if (receipts.length === 0) {
											return (
												<div className="text-sm text-muted-foreground h-full flex items-center justify-center">No payments yet.</div>
											)
										}

										return receipts.map((r, idx) => {
											const ts = r.created_at ? new Date(r.created_at * 1000).toLocaleString() : ''
											const amountTag = r.tags.find((t) => t[0] === 'amount') as any
											const amount = amountTag ? parseInt(amountTag[1] as string, 10) : undefined
											return (
												<div key={r.id || `receipt-${idx}`} className="flex items-center justify-between rounded border border-black p-3 fg-layer-overlay hover:bg-layer-overlay">
													<div className="min-w-0">
														<div className="text-sm font-medium truncate">{amount ? `${amount.toLocaleString()} sats` : 'Payment'}</div>
														<div className="text-xs text-muted-foreground truncate">{ts}</div>
													</div>
													<div className="text-xs font-mono px-2 py-0.5 rounded border">{r.kind}</div>
												</div>
											)
										})
									})()}
									<div className="h-0 lg:h-4" />
								</div>
							</CardContent>
						</Card>
					</div>
				)
			
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
								<CardContent className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
									<div className="mt-2 space-y-3 h-full pb-2 lg:pb-6">
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
											<div className="text-sm text-muted-foreground h-full flex items-center justify-center">
												No sales yet.
											</div>
										)}
										{isMobile && filteredOrders.length > 4 && (
											<div className="pt-2">
												<Button className="w-full bg-black text-white hover:bg-black/90" onClick={() => setShowAllMobileSales((v) => !v)}>
													{showAllMobileSales ? 'View less' : 'View all'}
												</Button>
											</div>
										)}
										<div className="h-0 lg:h-4" />
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
									</CardTitle>
								</CardHeader>
								<CardContent className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
									<div className="space-y-3 h-full">
										{productsLoading ? (
											<div className="text-sm text-muted-foreground h-full flex items-center justify-center">Loading products...</div>
										) : products.length === 0 ? (
											<div className="text-sm text-muted-foreground h-full flex items-center justify-center">No products found.</div>
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
																<div className="text-xs text-muted-foreground truncate">{price ? `${price[1]} ${price[2]}` : 'No price'}</div>
															</div>
														</Link>
													</div>
												)
											})
										)}
										<div className="h-0 lg:h-4" />
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
								<CardHeader className="p-4">
									<CardTitle className="flex items-center justify-between gap-3">
										<span>Sales Trend</span>
										<Select value={salesRange} onValueChange={(v) => setSalesRange(v as any)}>
											<SelectTrigger className="w-40">
												<SelectValue placeholder="All Time" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="today">Today</SelectItem>
												<SelectItem value="week">Last Week</SelectItem>
												<SelectItem value="month">Last Month</SelectItem>
												<SelectItem value="year">Last Year</SelectItem>
												<SelectItem value="all">All Time</SelectItem>
											</SelectContent>
										</Select>
									</CardTitle>
								</CardHeader>
								<CardContent className="flex-1 min-h-0 overflow-hidden p-2">
									<div className="h-full">
										<div ref={chartContainerRef} className="relative h-full w-full min-h-[220px]">
											<UplotReact options={{ ...(uplotOpts as any), width: chartWidth, height: chartHeight }} data={uplotData as any} />
											{tooltip.show && (
												<div
													className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full bg-black text-white text-xs px-2 py-1 rounded shadow"
													style={{ left: tooltip.left, top: tooltip.top - 8 }}
												>
													<div className="font-semibold">{tooltip.value}</div>
													<div className="opacity-80">{tooltip.label}</div>
												</div>
											)}
										</div>
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
								<CardHeader className="px-4 py-4">
									<CardTitle className="flex items-center justify-between">
										<span>Latest Messages</span>
										<span className="text-sm text-muted-foreground">{conversationsLoading ? 'Loading…' : `${conversations.length}`}</span>
									</CardTitle>
								</CardHeader>
								<CardContent className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
									<div className="space-y-3 h-full">
										{conversations.map((c) => (
											<Link
												key={c.pubkey}
												to="/dashboard/sales/messages/$pubkey"
												params={{ pubkey: c.pubkey }}
												search={{ from: 'dashboard' } as any}
												className="flex items-center justify-between rounded border border-black p-3 fg-layer-overlay hover:bg-layer-overlay"
											>
												<div className="min-w-0">
													<div className="text-sm font-medium truncate">{c.profile?.name || c.profile?.displayName || c.pubkey.slice(0, 8)}</div>
													<div className="text-xs text-muted-foreground truncate">{c.lastMessageSnippet}</div>
												</div>
												<div className="text-xs text-muted-foreground ml-4 whitespace-nowrap">
													{c.lastMessageAt ? new Date(c.lastMessageAt * 1000).toLocaleTimeString() : ''}
												</div>
											</Link>
										))}
										{!conversationsLoading && conversations.length === 0 && (
											<div className="text-sm text-muted-foreground h-full flex items-center justify-center">
												No messages yet.
											</div>
										)}
										<div className="h-0 lg:h-4" />
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
								<CardHeader className="px-4 py-4">
									<CardTitle className="flex items-center justify-between">
										<span>Latest Nostr Posts</span>
										<span className="text-sm text-muted-foreground">{postsLoading ? 'Loading…' : `${posts.length}`}</span>
									</CardTitle>
								</CardHeader>
								<CardContent className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
									<div className="space-y-3 h-full">
										{posts.slice(0, visiblePostsCount).map((p) => (
											<Link
												key={p.id}
												to={`https://njump.me/${p.id}`}
												target="_blank"
												rel="noopener noreferrer"
												className="block rounded border border-black p-3 fg-layer-overlay hover:bg-layer-overlay transition-colors"
											>
												<div className="text-sm font-medium mb-1">{p.author.slice(0, 8)}</div>
												<div className="text-sm line-clamp-3 whitespace-pre-wrap break-words">{p.content}</div>
												<div className="text-xs text-muted-foreground mt-2">
													{new Date(p.createdAt * 1000).toLocaleString()}
												</div>
											</Link>
										))}
										{!postsLoading && posts.length === 0 && (
											<div className="text-sm text-muted-foreground h-full flex items-center justify-center">
												No posts found.
											</div>
										)}
										{posts.length > visiblePostsCount && (
											<div className="pt-2">
												<Button
													onClick={() => setVisiblePostsCount((n) => n + 20)}
													className="w-full"
													variant="primary"
												>
													Load more
												</Button>
											</div>
										)}
										<div className="h-0 lg:h-4" />
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				)
			
			case 'LowStock':
				return (
					<div key={widget.id} className={baseClasses}>
						{isLoading ? (
							<LowStockLoader />
						) : (
							<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
								<CardHeader className="px-4 py-4">
									<CardTitle className="flex items-center justify-between">
										<span>Low Stock</span>
										<span className="text-sm text-muted-foreground">{myProductsLoading ? 'Loading…' : `${myProducts.length}`}</span>
									</CardTitle>
								</CardHeader>
								<CardContent className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
									<div className="space-y-3 h-full">
										{(() => {
											const withStock = (myProducts || []).map((p) => ({
												product: p,
												stock: (() => { const s = getProductStock(p); return s ? parseInt(s[1] as string, 10) : Number.POSITIVE_INFINITY })(),
											}))
											.filter((x) => Number.isFinite(x.stock))
											.sort((a, b) => a.stock - b.stock)
											.slice(0, 8)
											
											if (withStock.length === 0) {
												return (
													<div className="text-sm text-muted-foreground h-full flex items-center justify-center">No low stock items.</div>
												)
											}

											return withStock.map(({ product, stock }) => {
												const images = getProductImages(product)
												const imageUrl = images?.[0]?.[1]
												const title = getProductTitle(product)
												return (
													<div key={product.id} className="flex items-center justify-between rounded border border-black p-3 fg-layer-overlay hover:bg-layer-overlay">
														<Link to="/products/$productId" params={{ productId: product.id }} className="flex min-w-0 items-center gap-3">
															<div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs font-mono overflow-hidden">
																{imageUrl ? (
																	<img src={imageUrl} alt={title} className="h-full w-full object-cover" />
																) : (
																	(title && typeof title === 'string' ? title.slice(0, 2) : '??')
																)}
															</div>
															<div className="min-w-0">
																<div className="text-sm font-medium truncate">{title}</div>
																<div className="text-xs text-muted-foreground truncate">Stock: {stock}</div>
															</div>
														</Link>
														<div className="text-xs font-mono px-2 py-0.5 rounded border">{stock}</div>
													</div>
												)
											})
										})()}
										<div className="h-0 lg:h-4" />
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				)
			
			case 'PopularCategories':
				return (
					<div key={widget.id} className={baseClasses}>
						{isLoading ? (
							<NostrPostsLoader />
						) : (
							<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded lg:shadow-xl">
								<CardHeader className="px-4 py-4">
									<CardTitle className="flex items-center justify-between">
										<span>Popular Categories</span>
									</CardTitle>
								</CardHeader>
								<CardContent className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
									<div className="space-y-3 h-full">
										{(() => {
											const counts = new Map<string, number>()
											for (const p of products || []) {
												const cats = getProductCategories(p)
												for (const c of cats) {
													const name = c[1]
													counts.set(name, (counts.get(name) || 0) + 1)
												}
											}
											const sorted = Array.from(counts.entries()).sort((a,b) => b[1]-a[1]).slice(0,8)
											if (sorted.length === 0) return (<div className="text-sm text-muted-foreground h-full flex items-center justify-center">No categories yet.</div>)
											return sorted.map(([name, count]) => (
												<div key={name} className="flex items-center justify-between rounded border border-black p-3 fg-layer-overlay hover:bg-layer-overlay">
													<div className="min-w-0">
														<div className="text-sm font-medium truncate">{name}</div>
														<div className="text-xs text-muted-foreground truncate">{count} listings</div>
													</div>
													<div className="text-xs font-mono px-2 py-0.5 rounded border">{count}</div>
												</div>
											))
										})()}
										<div className="h-0 lg:h-4" />
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
				<div className={cn(
					// If right column is empty, let main grid span all 3 columns on desktop
					layoutWidgets.right.length === 0 ? 'lg:col-span-3' : 'lg:col-span-2',
					'grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-2 gap-4 min-h-0'
				)}>
					{/* Top Row */}
					{layoutWidgets.top.map((widget, index) => (
						<div key={widget.id} className={layoutWidgets.top.length === 1 ? 'lg:col-span-2' : 'lg:col-span-1'}>
							{renderWidget(widget)}
						</div>
					))}
					
					{/* Bottom Row */}
					{layoutWidgets.bottom.map((widget, index) => (
						<div key={widget.id} className={layoutWidgets.bottom.length === 1 ? 'lg:col-span-2' : 'lg:col-span-1'}>
							{renderWidget(widget)}
						</div>
					))}
				</div>

				{/* Right Column */}
				{layoutWidgets.right.length > 0 && (
					<div className="min-h-0 h-full flex flex-col gap-4">
						{layoutWidgets.right.map((widget) => (
							<div key={widget.id} className="flex-1 min-h-0">
								{renderWidget(widget)}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	)
}