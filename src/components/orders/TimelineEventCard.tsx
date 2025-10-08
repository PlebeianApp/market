import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { copyToClipboard } from '@/lib/utils'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { CheckCircle, Copy } from 'lucide-react'

interface TimelineEventCardProps {
	event: NDKEvent
	title: string
	icon: React.ReactNode
	type: string
	timelineIndex: number
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

export function TimelineEventCard({ event, title, icon, type, timelineIndex }: TimelineEventCardProps) {
	const eventDate = new Date((event.created_at || 0) * 1000).toLocaleString()
	const content = event.content
	let extraInfo = null
	let shippingDetails = null
	let paymentDetails = null

	const hasGreyContainer = type === 'status' || type === 'payment' || type === 'payment_request' || type === 'shipping'

	if (type === 'status') {
		const statusTag = event.tags.find((tag) => tag[0] === 'status')
		if (statusTag) {
			extraInfo = (
				<Badge variant="outline" className="w-full justify-center sm:w-auto sm:justify-start">
					{getTimelineStatusLabel(statusTag[1])}
				</Badge>
			)
		}
	} else if (type === 'payment' || type === 'payment_request') {
		const amountTag = event.tags.find((tag) => tag[0] === 'amount')
		const amount = amountTag?.[1] ? parseInt(amountTag[1], 10) : 0
		if (amount > 0) {
			if (type === 'payment') {
				extraInfo = (
					<Badge
						variant="outline"
						className="w-full justify-center border-green-300 bg-green-100 text-green-800 sm:w-auto sm:justify-start"
					>
						Paid: {amount.toLocaleString()} sats
					</Badge>
				)

				// Extract preimage from payment tag for receipts
				const paymentTag = event.tags.find((tag) => tag[0] === 'payment')
				const preimage = paymentTag?.[3] // Format: ["payment", "<medium>", "<medium-reference>", "<proof>"]

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
											onClick={() => copyToClipboard(preimage, 'Preimage copied to clipboard')}
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
			} else {
				extraInfo = (
					<Badge variant="outline" className="w-full justify-center sm:w-auto sm:justify-start">
						Request: {amount.toLocaleString()} sats
					</Badge>
				)
			}
		}
	} else if (type === 'shipping') {
		const statusTag = event.tags.find((tag) => tag[0] === 'status')
		const trackingTag = event.tags.find((tag) => tag[0] === 'tracking')
		const carrierTag = event.tags.find((tag) => tag[0] === 'carrier')

		if (statusTag) {
			extraInfo = (
				<Badge variant="outline" className="w-full justify-center sm:w-auto sm:justify-start">
					{getTimelineStatusLabel(statusTag[1])}
				</Badge>
			)
		}

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

	if (hasGreyContainer) {
		return (
			<Card key={event.id}>
				<CardHeader className="p-0">
					<div className="bg-gray-50 p-4 rounded-t-xl">
						<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex items-center gap-2">
								<div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600">
									{timelineIndex}
								</div>
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
		<Card key={event.id}>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600">
							{timelineIndex}
						</div>
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
