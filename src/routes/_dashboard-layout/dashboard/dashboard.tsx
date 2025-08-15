import { createFileRoute, Link } from '@tanstack/react-router'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { OrderActions } from '@/components/orders/OrderActions'
import { getStatusStyles } from '@/lib/utils/orderUtils'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
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

export const Route = createFileRoute('/_dashboard-layout/dashboard/dashboard')({
	component: DashboardInnerComponent,
})

function DashboardInnerComponent() {
	useDashboardTitle('Dashboard')
	const { data: orders = [], isLoading: ordersLoading } = useOrders()
	const { data: conversations = [], isLoading: convLoading } = useConversationsList()
	const { data: posts = [], isLoading: postsLoading } = useQuery(postsQueryOptions)
	const { user } = useStore(authStore)

	const [salesTab, setSalesTab] = React.useState<'all' | keyof typeof ORDER_STATUS>(
		'all',
	)

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
			const startOfToday = new Date()
			startOfToday.setHours(0, 0, 0, 0)
			switch (salesRange) {
				case 'today':
					return ts >= startOfToday.getTime()
				case 'week': {
					const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
					return ts >= sevenDaysAgo
				}
				case 'month': {
					const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
					return ts >= thirtyDaysAgo
				}
				case 'year': {
					const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000
					return ts >= oneYearAgo
				}
			}
		},
		[salesRange],
	)

	const timeRangeFilteredOrders = React.useMemo(() => {
		return orders.filter((o) => isWithinRange(o.order.created_at))
	}, [orders, isWithinRange])

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

	const salesSeries = React.useMemo(() => {
		const list = timeRangeFilteredOrders
		// Build buckets based on range
		if (salesRange === 'today') {
			const now = new Date()
			const start = new Date(now)
			start.setHours(0, 0, 0, 0)
			const buckets: { label: string; count: number }[] = []
			for (let h = 0; h < 24; h += 1) {
				const label = `${h}:00`
				buckets.push({ label, count: 0 })
			}
			list.forEach((o) => {
				if (!o.order.created_at) return
				const d = new Date(o.order.created_at * 1000)
				if (d < start) return
				const label = `${d.getHours()}:00`
				const b = buckets.find((x) => x.label === label)
				if (b) b.count += 1
			})
			return buckets
		}

		if (salesRange === 'week' || salesRange === 'month') {
			const days = salesRange === 'week' ? 7 : 30
			const now = new Date()
			const buckets: { label: string; count: number }[] = []
			for (let i = days - 1; i >= 0; i -= 1) {
				const d = new Date(now)
				d.setDate(now.getDate() - i)
				const label = `${d.getMonth() + 1}/${d.getDate()}`
				buckets.push({ label, count: 0 })
			}
			list.forEach((o) => {
				if (!o.order.created_at) return
				const d = new Date(o.order.created_at * 1000)
				const label = `${d.getMonth() + 1}/${d.getDate()}`
				const b = buckets.find((x) => x.label === label)
				if (b) b.count += 1
			})
			return buckets
		}

		// year or all: 12 months
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
		const buckets: { label: string; count: number }[] = months.map((m) => ({ label: m, count: 0 }))
		list.forEach((o) => {
			if (!o.order.created_at) return
			const d = new Date(o.order.created_at * 1000)
			const label = months[d.getMonth()]
			const b = buckets.find((x) => x.label === label)
			if (b) b.count += 1
		})
		return buckets
	}, [timeRangeFilteredOrders, salesRange])

	const maxSales = React.useMemo(() => Math.max(1, ...salesSeries.map((d) => d.count)), [salesSeries])

	// Determine which tick labels to show to avoid crowding
	const tickIndices = React.useMemo(() => {
		const length = salesSeries.length
		if (length === 0) return new Set<number>()
		let step = 1
		switch (salesRange) {
			case 'today':
				step = 3 // every 3 hours
				break
			case 'week':
				step = 1 // daily
				break
			case 'month':
				step = 5 // every 5 days
				break
			case 'year':
			case 'all':
				step = 2 // every 2 months
				break
		}
		const indices = new Set<number>()
		for (let i = 0; i < length; i += step) indices.add(i)
		// Always ensure last label shows
		indices.add(length - 1)
		return indices
	}, [salesRange, salesSeries.length])

	// Prepare uPlot data
	const uplotData = React.useMemo(() => {
		const x = salesSeries.map((_, i) => i)
		const y = salesSeries.map((d) => d.count)
		return [x, y]
	}, [salesSeries])

	// Measure container width/height so uPlot sizes correctly and place tooltip
	const chartContainerRef = React.useRef<HTMLDivElement | null>(null)
	const [chartWidth, setChartWidth] = React.useState<number>(300)
	const [chartHeight, setChartHeight] = React.useState<number>(180)
	const [tooltip, setTooltip] = React.useState<{ show: boolean; left: number; top: number; label: string; value: number }>({
		show: false,
		left: 0,
		top: 0,
		label: '',
		value: 0,
	})
	const lastCursorUpdateRef = React.useRef(0)

	React.useEffect(() => {
		if (!chartContainerRef.current) return
		const el = chartContainerRef.current
		const ro = new ResizeObserver(() => {
			const w = Math.max(200, el.clientWidth)
			// Clamp height on small screens to avoid growth loops
			const isSmallScreen = window.matchMedia('(max-width: 1023px)').matches
			const measured = Math.max(150, el.clientHeight)
			const h = isSmallScreen ? Math.min(measured, 240) : measured
			setChartWidth(w)
			setChartHeight(h)
		})
		ro.observe(el)
		setChartWidth(Math.max(200, el.clientWidth))
		const initialMeasured = Math.max(150, el.clientHeight)
		setChartHeight(window.matchMedia('(max-width: 1023px)').matches ? Math.min(initialMeasured, 240) : initialMeasured)
		return () => ro.disconnect()
	}, [])

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
			// Tighten plot padding: [top, right, bottom, left]
			padding: [4, 6, 14, 6],
			scales: { x: { time: false }, y: { auto: true } },
			axes: [
				{
					grid: { show: true, stroke: gridColor },
					gap: 2,
					values: (u: any, splits: number[]) => splits.map((v) => salesSeries[Math.round(v)]?.label ?? ''),
				},
				{
					side: 3,
					grid: { show: true, stroke: gridColor },
					gap: 2,
					values: (u: any, splits: number[]) => splits.map((v) => String(Math.round(v))),
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

	// (moved above) Measure container width/height so uPlot sizes correctly and place tooltip

	return (
		<div className="h-full min-h-0 flex flex-col">
			{/* Unified 2x2 grid for symmetrical layout with inner scrolls */}
			<div className="grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-2 gap-4 h-full min-h-0 overflow-hidden">
				<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded">
					<CardHeader className="p-4">
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
					<CardContent className="flex-1 min-h-0 overflow-y-auto">
						<div className="mt-2 space-y-3 pr-2">
							{filteredOrders.map((o) => {
								const orderId = getOrderId(o.order) || o.order.id
								const amount = formatSats(getOrderAmount(o.order))
								const date = getEventDate(o.order)
								const status = getOrderStatus(o)
								const { bgColor, textColor } = getStatusStyles(o)
								return (
									<div key={orderId} className="flex items-center justify-between rounded border border-black p-3 fg-layer-overlay hover:bg-layer-overlay">
										<Link
											to="/dashboard/orders/$orderId"
											params={{ orderId }}
											className="flex min-w-0 items-center gap-3"
										>
											<div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs font-mono">{orderId.slice(0, 4)}</div>
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
						</div>
					</CardContent>
				</Card>

				<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded">
					<CardHeader className="p-4">
						<CardTitle className="flex items-center justify-between">
							<span>Latest Messages</span>
							<span className="text-sm text-muted-foreground">{convLoading ? 'Loading…' : `${conversations.length}`}</span>
						</CardTitle>
					</CardHeader>
					<CardContent className="flex-1 min-h-0 overflow-y-auto">
						<div className="space-y-3 pr-2">
							{conversations.map((c) => (
								<Link
									key={c.pubkey}
									to="/dashboard/sales/messages/$pubkey"
									params={{ pubkey: c.pubkey }}
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
							{!convLoading && conversations.length === 0 && <div className="text-sm text-muted-foreground">No messages yet.</div>}
						</div>
					</CardContent>
				</Card>

				<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded">
					<CardHeader className="p-4">
						<CardTitle className="flex items-center justify-between gap-3">
							<span>Sales</span>
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
					<CardContent className="flex-1 min-h-0 overflow-hidden pb-4">
						<div className="mt-1 h-56 lg:h-full">
							<div ref={chartContainerRef} className="relative h-full rounded border border-black fg-layer-overlay">
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

				<Card className="min-h-0 h-full flex flex-col overflow-hidden fg-layer-elevated border border-black rounded">
					<CardHeader className="p-4">
						<CardTitle className="flex items-center justify-between">
							<span>Latest Nostr Posts</span>
							<span className="text-sm text-muted-foreground">{postsLoading ? 'Loading…' : `${posts.length}`}</span>
						</CardTitle>
					</CardHeader>
					<CardContent className="flex-1 min-h-0 overflow-y-auto">
						<div className="space-y-3 pr-2">
							{posts.slice(0, visiblePostsCount).map((p) => (
								<div key={p.id} className="rounded border border-black p-3 fg-layer-overlay">
									<div className="text-sm font-medium mb-1">{p.author.slice(0, 8)}</div>
									<div className="text-sm line-clamp-3 whitespace-pre-wrap break-words">{p.content}</div>
									<div className="text-xs text-muted-foreground mt-2">
										{new Date(p.createdAt * 1000).toLocaleString()}
									</div>
								</div>
							))}
							{!postsLoading && posts.length === 0 && <div className="text-sm text-muted-foreground">No posts found.</div>}
							{posts.length > visiblePostsCount && (
								<div className="pt-2">
									<Button
										onClick={() => setVisiblePostsCount((n) => n + 20)}
										className="w-full bg-black text-white hover:bg-black/90"
									>
										Load more
									</Button>
								</div>
							)}
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}


