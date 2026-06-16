import React, { useEffect, useState } from 'react'
import {
	ScatterChart,
	Scatter,
	XAxis,
	YAxis,
	Text as RechartsText,
	CartesianGrid,
	Tooltip,
	ReferenceLine,
	ReferenceArea,
	ResponsiveContainer,
	Label,
} from 'recharts'
import type { LabelPosition } from 'recharts/types/component/Label'
import { UserCard } from './UserCard'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { getBidAmount } from '@/queries/auctions'

// Function to generate color from pubkey
const getPubkeyColor = (pubkey: string) => {
	if (!pubkey) return '#3b82f6' // default blue
	return '#' + pubkey.slice(0, 6)
}

// ============================================
// CUSTOM SHAPE COMPONENT: "LOLLIPOP BAR"
// Draws a thick vertical line (bar) + a circle (dot) at the top.
// ============================================

const CustomBarShape = (props: any) => {
	if (props.isGhost) {
		return <g></g>
	}

	const { cx, cy, payload } = props
	const pubkey = payload?.pubkey
	const fill = getPubkeyColor(pubkey)

	if (!cx || !cy) return null

	// NOTE: The "310" value is a hard-coded estimate for the height of the chart. This could be improved to become a calculated value.
	const bottomY = 310 - cy + props.y

	return (
		<g>
			{/* The Stem */}
			<line
				x1={cx}
				y1={cy}
				x2={cx}
				y2={bottomY} // Extends far below the visible area
				stroke={fill || '#3b82f6'}
				strokeWidth={14}
				strokeLinecap="round"
				opacity={0.9}
			/>
			{/* The Dot */}
			<circle cx={cx} cy={cy} r={6} fill={fill || '#3b82f6'} stroke="#ffffff" strokeWidth={2} />
		</g>
	)
}

// ============================================
// TOOLTIP
// ============================================

const CustomTooltip = ({ active, payload }: any) => {
	if (!active || !payload?.length) return null
	const data = payload[0].payload
	if (!data) return null

	const dateStr = new Date(data.x).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

	return (
		<div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-40 z-50">
			{data.pubkey && (
				<div className="mb-2">
					<UserCard pubkey={data.pubkey} size="sm" subtitle="none" onPress="profile" />
				</div>
			)}
			<p className="text-xs text-foreground mb-1">{dateStr}</p>
			<p className="font-semibold text-secondary">{data.y.toLocaleString()} sats</p>
		</div>
	)
}

// ============================================
// CUSTOM TICK FORMATTERS
// ============================================

// Function to round to nearest number with 2 significant figures
const roundToSignificantFigures = (num: number): number => {
	if (num === 0) return 0

	const magnitude = Math.floor(Math.log10(Math.abs(num)))
	const factor = Math.pow(10, 2 - magnitude - 1)
	return Math.round(num * factor) / factor
}

const formatXAxisTick = (timestamp: number, auctionStart: number, refundTime: number) => {
	// Only show times within the auction period
	if (timestamp < auctionStart || timestamp > refundTime) return ''

	const date = new Date(timestamp)

	return date.toLocaleTimeString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: true,
	})
}

const formatYAxisTick = (value: number) => {
	// Round to 2 significant figures first
	const roundedValue = roundToSignificantFigures(value)

	// Format large numbers with K (thousands) or M (millions) suffixes
	if (roundedValue >= 1000000) {
		return `${(roundedValue / 1000000).toFixed(1)}M`
	}
	if (roundedValue >= 1000) {
		return `${(roundedValue / 1000).toFixed(1)}K`
	}

	// For small numbers round to 2 significant figures
	if (roundedValue < 100) {
		return roundToSignificantFigures(roundedValue).toString()
	}

	return roundedValue.toString()
}

// Function to generate nice rounded values for Y axis based on requirements:
// - Starting bid should be at ~5% from bottom
// - Max bid/reserve should be at ~70% of height
// - If no bids/reserve, starting bid should have ~60% above it
const generateYAxisConfig = (startingBid: number, reserve: number, bids: Array<{ y: number }>) => {
	const allBidValues = bids.map((b) => b.y)
	const hasBids = allBidValues.length > 0
	const maxBid = hasBids ? Math.max(...allBidValues) : 0
	const maxBidOrReserve = reserve > 0 ? Math.max(reserve, maxBid) : maxBid

	// If we have max bid or reserve, position starting bid at 5% from bottom and max at 70% height
	if (maxBidOrReserve > 0) {
		// Calculate the total range needed to position starting bid at 5% and max at 70%
		const rangeNeeded = (maxBidOrReserve - startingBid) / 0.65 // 65% between 5% and 70%
		const actualMin = startingBid - rangeNeeded * 0.05 // 5% margin below starting bid
		const actualMax = actualMin + rangeNeeded

		return { yMin: actualMin, yMax: actualMax, hasDefinedRange: true }
	}

	// If no bids/reserve, position starting bid with 60% above it
	const rangeNeeded = startingBid / 0.4 // 40% below to give 60% above
	const actualMin = startingBid - rangeNeeded * 0.4
	const actualMax = actualMin + rangeNeeded

	return { yMin: actualMin, yMax: actualMax, hasDefinedRange: false }
}

// Function to generate ticks with 2 significant figures, including below starting bid
const generateYTicks = (yMin: number, yMax: number, count: number = 12): number[] => {
	const ticks: number[] = []

	// Calculate tick spacing based on the full range
	const range = yMax - yMin
	const tickSpacing = range / (count - 1)

	// Round tick spacing to nice intervals with 2 significant figures
	const magnitude = Math.pow(10, Math.floor(Math.log10(tickSpacing)))
	let tickStep = tickSpacing / magnitude

	// Choose nice step sizes
	if (tickStep <= 1) tickStep = 1
	else if (tickStep <= 2) tickStep = 2
	else if (tickStep <= 5) tickStep = 5
	else tickStep = 10

	tickStep *= magnitude
	const roundedTickStep = roundToSignificantFigures(tickStep)

	// Generate ticks starting from the bottom
	let currentTick = Math.floor(yMin / roundedTickStep) * roundedTickStep

	// Generate ticks across the entire range
	while (currentTick <= yMax && ticks.length < count * 2) {
		// Only add if it's within our domain and not a duplicate
		if (currentTick >= yMin && currentTick <= yMax) {
			const roundedTick = roundToSignificantFigures(currentTick)
			if (!ticks.includes(roundedTick)) {
				ticks.push(roundedTick)
			}
		}
		currentTick += roundedTickStep
	}

	// Sort and limit to count
	return ticks
		.sort((a, b) => a - b)
		.filter((tick, index) => index < count)
		.filter((tick) => tick >= yMin && tick <= yMax)
}

// ============================================
// MAIN COMPONENT
// ============================================

interface AuctionTimelineChartProps {
	bids: NDKEvent[]
	auctionStart: number
	effectiveEndAt: number
	absoluteEndAt: number
	refundTime: number
	startingBid: number
	reserve: number
	currentPrice: number
}

interface VerticalLineMarker {
	label: string
	ts: number
	color: string
	position?: LabelPosition
}

interface HorizontalLineMarker {
	label: string
	val: number
	color: string
	position?: LabelPosition
}

export default function AuctionTimelineChart({
	bids,
	auctionStart,
	effectiveEndAt,
	absoluteEndAt,
	refundTime,
	startingBid,
	reserve,
}: AuctionTimelineChartProps) {
	// Transform bids to chart data format
	const chartBids = bids.map((bid) => ({
		x: (bid.created_at || 0) * 1000,
		y: getBidAmount(bid),
		pubkey: bid.pubkey,
		id: bid.id,
	}))

	const displayData =
		chartBids.length > 0
			? chartBids
			: [
					{
						x: auctionStart + (refundTime - auctionStart) / 2, // Center time
						y: startingBid,
						id: 'ghost',
						name: 'No Bids Yet',
						isGhost: true, // Custom flag
					},
				]

	// State for current time
	const [currentTime, setCurrentTime] = useState(Date.now())

	// Update current time every minute
	useEffect(() => {
		const timer = setInterval(() => {
			setCurrentTime(Date.now())
		}, 60000) // Update every minute

		return () => clearInterval(timer)
	}, [])

	// Calculate 5% margin for x-axis
	const totalTimeSpan = refundTime - auctionStart
	const margin = totalTimeSpan * 0.05

	const xMin = auctionStart - margin
	const xMax = refundTime + margin

	// Determine y-axis boundaries based on requirements
	const yAxisConfig = generateYAxisConfig(startingBid, reserve, chartBids)
	const { yMin, yMax } = yAxisConfig

	// Generate Y-axis ticks
	const yTicks = generateYTicks(yMin, yMax, 12)

	// Build vertical markers based on conditions
	const verticalMarkers: VerticalLineMarker[] = [
		{ label: 'Start', ts: auctionStart, color: '#94a3b8', position: 'insideTopRight' },
		{ label: 'Refund', ts: refundTime, color: '#22c55e' },
	]

	// Add effective end time if it's different from both start and absolute end
	const hasDistinctEffectiveEnd = effectiveEndAt !== auctionStart && effectiveEndAt !== absoluteEndAt
	if (hasDistinctEffectiveEnd) {
		verticalMarkers.push({ label: 'Effective End', ts: effectiveEndAt, color: '#f59e0b' })
	}

	// Add absolute end time if it's different from start time
	const hasDistinctAbsoluteEnd = absoluteEndAt !== auctionStart
	if (hasDistinctAbsoluteEnd && !hasDistinctEffectiveEnd) {
		verticalMarkers.push({ label: 'Auction End', ts: absoluteEndAt, color: '#ef4444', position: 'insideTopRight' })
	} else if (hasDistinctAbsoluteEnd && hasDistinctEffectiveEnd && effectiveEndAt !== absoluteEndAt) {
		verticalMarkers.push({ label: 'Initial End', ts: absoluteEndAt, color: '#ef4444', position: 'insideTopRight' })
	}

	// Add current time marker if it's within the auction period
	const isCurrentTimeVisible = currentTime >= xMin && currentTime <= xMax
	if (isCurrentTimeVisible) {
		verticalMarkers.push({ label: 'Now', ts: currentTime, color: '#8b5cf6', position: 'insideLeft' })
	}

	// Build horizontal markers - always include starting bid
	const horizontalMarkers: HorizontalLineMarker[] = [
		{ label: `Starting Bid (${startingBid.toLocaleString()} sats)`, val: startingBid, color: '#f59e0b', position: 'insideBottomLeft' },
	]

	// Only add reserve if it exists and is greater than 0
	if (reserve > 0) {
		horizontalMarkers.push({
			label: `Reserve (${reserve.toLocaleString()} sats)`,
			val: reserve,
			color: '#ef4444',
			position: 'insideBottomLeft',
		})
	}

	const settlementStart = effectiveEndAt
	const settlementEnd = refundTime

	// Generate custom ticks for x-axis
	const generateXTicks = () => {
		const ticks = []
		const tickCount = 12 // Number of ticks to display
		const interval = (refundTime - auctionStart) / (tickCount - 1)

		for (let i = 0; i < tickCount; i++) {
			ticks.push(auctionStart + interval * i)
		}

		// Ensure the last tick is exactly the end time
		ticks[ticks.length - 1] = refundTime

		return ticks
	}

	return (
		<div className="w-full h-125 flex flex-col bg-white p-4 rounded-lg shadow-sm border border-gray-100">
			<div className="mb-4">
				<h3 className="text-lg font-bold text-gray-900">Auction Timeline</h3>
				<p className="text-sm text-gray-500">Visualizing bids over time with key auction events.</p>
			</div>

			<ResponsiveContainer width="100%" height="100%">
				<ScatterChart margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
					<CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />

					<XAxis
						type="number"
						dataKey="x"
						domain={[xMin, xMax]}
						ticks={generateXTicks()}
						tickFormatter={(ts) => formatXAxisTick(ts, auctionStart, refundTime)}
						angle={-45}
						textAnchor="end"
						height={70}
						tick={{ fontSize: 11, fill: '#6b7280' }}
					/>

					<YAxis
						type="number"
						domain={[yMin, yMax]}
						ticks={yTicks}
						tickFormatter={formatYAxisTick}
						width={70}
						tick={{ fontSize: 11, fill: '#6b7280' }}
						unit=" sats"
					/>

					{/* SCATTER WITH CUSTOM SHAPE */}
					<Scatter
						name="Bids"
						data={displayData}
						dataKey="y"
						shape={CustomBarShape} // ✅ Pass function reference directly
						fill="#3b82f6"
						isAnimationActive={false}
						animationDuration={800}
					/>

					{/* 2. Conditionally Render the "No bids yet" text */}
					{chartBids.length === 0 && <Label position="center">No bids yet</Label>}

					{/* Shaded Area */}
					<ReferenceArea
						x1={settlementStart}
						x2={settlementEnd}
						fill="#8b5cf6"
						fillOpacity={0.15}
						stroke="#8b5cf6"
						strokeDasharray="4 4"
						label={{ position: 'insideTop', value: 'Settlement Window', fill: '#7c3aed', fontSize: 11, fontWeight: 600 }}
					/>

					{/* Vertical Lines */}
					{verticalMarkers.map((m, i) => (
						<ReferenceLine
							key={`v-${i}`}
							x={m.ts}
							stroke={m.color}
							strokeDasharray="4 4"
							label={{ position: m.position ?? 'insideTopLeft', value: m.label, fill: m.color, fontSize: 11, fontWeight: 600 }}
						/>
					))}

					{/* Horizontal Lines */}
					{horizontalMarkers.map((m, i) => (
						<ReferenceLine
							key={`h-${i}`}
							y={m.val}
							stroke={m.color}
							strokeDasharray="4 4"
							label={{ position: m.position ?? 'left', value: m.label, fill: m.color, fontSize: 11, fontWeight: 600 }}
						/>
					))}

					<Tooltip
						content={<CustomTooltip />}
						cursor={{ stroke: '#9ca3af', strokeDasharray: '3 3' }}
						wrapperStyle={{ outline: 'none' }}
						isAnimationActive={false}
					/>
				</ScatterChart>
			</ResponsiveContainer>
		</div>
	)
}
