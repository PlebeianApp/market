import type { ReactNode } from 'react'
import { CheckCircle, Copy } from 'lucide-react'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../primitives/card'

export interface TimelineEventCardEvent {
	id: string
	created_at?: number
	content: string
	tags: string[][]
}

export interface TimelineEventCardProps {
	event: TimelineEventCardEvent
	title: string
	icon: ReactNode
	type: string
	timelineIndex: number
	onCopyPreimage: (preimage: string) => void
}

function getTimelineStatusLabel(status: string): string {
	switch (status) {
		case 'confirmed':
			return 'Order Confirmed'
		case 'processing':
			return 'Order Processing'
		case 'shipped':
			return 'Order Shipped'
		default:
			return status.charAt(0).toUpperCase() + status.slice(1)
	}
}

const badgeClass = 'w-full justify-center sm:w-auto sm:justify-start'

export function TimelineEventCard({ event, title, icon, type, timelineIndex, onCopyPreimage }: TimelineEventCardProps) {
	const eventDate = new Date((event.created_at || 0) * 1000).toLocaleString()
	const content = event.content
	const findTag = (name: string) => event.tags.find((tag) => tag[0] === name)
	let extraInfo: ReactNode = null
	let shippingDetails: ReactNode = null
	let paymentDetails: ReactNode = null

	const hasGreyContainer = type === 'status' || type === 'payment' || type === 'payment_request' || type === 'shipping'

	if (type === 'status' || type === 'shipping') {
		const statusTag = findTag('status')
		if (statusTag) {
			extraInfo = (
				<Badge variant="outline" className={badgeClass}>
					{getTimelineStatusLabel(statusTag[1])}
				</Badge>
			)
		}
	}

	if (type === 'payment' || type === 'payment_request') {
		const amountTag = findTag('amount')
		const amount = amountTag?.[1] ? parseInt(amountTag[1], 10) : 0
		if (amount > 0 && type === 'payment_request') {
			extraInfo = (
				<Badge variant="outline" className={badgeClass}>
					Request: {amount.toLocaleString()} sats
				</Badge>
			)
		}
		if (amount > 0 && type === 'payment') {
			extraInfo = (
				<Badge variant="outline" className={`${badgeClass} border-green-300 bg-green-100 text-green-800`}>
					Paid: {amount.toLocaleString()} sats
				</Badge>
			)

			// Receipt tag format: ["payment", "<medium>", "<medium-reference>", "<proof>"]
			const preimage = findTag('payment')?.[3]
			if (preimage) {
				paymentDetails = (
					<div className="space-y-3">
						<div className="flex items-center gap-2 text-green-700">
							<CheckCircle className="w-4 h-4" />
							<span className="text-sm font-medium">Payment Verified</span>
						</div>
						<div className="bg-green-50 border border-green-200 rounded-lg p-3">
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<span className="text-xs font-medium text-green-700 uppercase tracking-wide">Payment Proof (Preimage)</span>
									<Button
										variant="ghost"
										size="sm"
										className="h-6 px-2 text-green-700 hover:text-green-900 hover:bg-green-100"
										onClick={() => onCopyPreimage(preimage)}
									>
										<Copy className="h-3 w-3" />
									</Button>
								</div>
								<div className="font-mono text-xs text-green-900 break-all bg-white rounded px-2 py-1 border border-green-200">
									{preimage}
								</div>
							</div>
						</div>
					</div>
				)
			}
		}
	}

	if (type === 'shipping') {
		const trackingTag = findTag('tracking')
		const carrierTag = findTag('carrier')
		if (trackingTag || carrierTag) {
			shippingDetails = (
				<div className="space-y-2">
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
		}
	}

	const indexBadge = (
		<div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600">{timelineIndex}</div>
	)

	if (hasGreyContainer) {
		return (
			<Card>
				<CardHeader className="p-0">
					<div className="bg-gray-50 p-4 rounded-t-xl">
						<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex items-center gap-2">
								{indexBadge}
								{icon}
								<CardTitle className="text-lg">{title}</CardTitle>
							</div>
							{extraInfo}
						</div>
					</div>
				</CardHeader>
				{(content || shippingDetails || paymentDetails) && (
					<CardContent className="pt-4 space-y-4">
						{content && <p className="text-gray-700">{content}</p>}
						{shippingDetails}
						{paymentDetails}
					</CardContent>
				)}
				<CardFooter className="flex justify-center pt-4">
					<span className="text-xs text-muted-foreground">{eventDate}</span>
				</CardFooter>
			</Card>
		)
	}

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						{indexBadge}
						{icon}
						<CardTitle className="text-lg">{title}</CardTitle>
					</div>
				</div>
				{extraInfo && <div className="mt-2">{extraInfo}</div>}
			</CardHeader>
			{content && (
				<CardContent className="pt-0">
					<p className="text-gray-700">{content}</p>
				</CardContent>
			)}
			<CardFooter className="flex justify-center">
				<span className="text-xs text-muted-foreground">{eventDate}</span>
			</CardFooter>
		</Card>
	)
}
