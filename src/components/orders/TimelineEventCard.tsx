import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

interface TimelineEventCardProps {
	event: NDKEvent
	title: string
	icon: React.ReactNode
	type: string
}

export function TimelineEventCard({ event, title, icon, type }: TimelineEventCardProps) {
	const eventDate = new Date((event.created_at || 0) * 1000).toLocaleString()
	const content = event.content
	let extraInfo = null
	let shippingDetails = null

	const hasGreyContainer = type === 'status' || type === 'payment' || type === 'payment_request' || type === 'shipping'

	if (type === 'status') {
		const statusTag = event.tags.find((tag) => tag[0] === 'status')
		if (statusTag) {
			extraInfo = <Badge variant="outline">{statusTag[1].charAt(0).toUpperCase() + statusTag[1].slice(1)}</Badge>
		}
	} else if (type === 'payment' || type === 'payment_request') {
		const amountTag = event.tags.find((tag) => tag[0] === 'amount')
		const amount = amountTag?.[1] ? parseInt(amountTag[1], 10) : 0
		if (amount > 0) {
			if (type === 'payment') {
				extraInfo = (
					<Badge variant="outline" className="border-green-300 bg-green-100 text-green-800">
						Paid: {amount.toLocaleString()} sats
					</Badge>
				)
			} else {
				extraInfo = <Badge variant="outline">Request: {amount.toLocaleString()} sats</Badge>
			}
		}
	} else if (type === 'shipping') {
		const statusTag = event.tags.find((tag) => tag[0] === 'status')
		const trackingTag = event.tags.find((tag) => tag[0] === 'tracking')
		const carrierTag = event.tags.find((tag) => tag[0] === 'carrier')

		if (statusTag) {
			extraInfo = <Badge variant="outline">Status: {statusTag[1]}</Badge>
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
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								{icon}
								<CardTitle className="text-lg">{title}</CardTitle>
							</div>
							{extraInfo}
						</div>
					</div>
				</CardHeader>
				{(content || shippingDetails) && (
					<CardContent className="pt-4 space-y-4">
						{content && <p className="text-gray-700">{content}</p>}
						{shippingDetails}
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