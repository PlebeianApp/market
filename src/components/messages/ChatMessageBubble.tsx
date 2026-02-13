import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { LazyImage } from '@/components/ui/lazy-image'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { format } from 'date-fns' // For formatting timestamp
import {
	ShoppingCartIcon,
	CreditCardIcon,
	PackageCheckIcon,
	ClipboardListIcon,
	ReceiptIcon,
	AlertCircleIcon,
	MessageSquareIcon,
	PackageIcon,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchProductByATag, useProductTitle, useProductPrice, useProductImages } from '@/queries/products'
import { getCoordsFromATag } from '@/lib/utils/coords'
import { Link } from '@tanstack/react-router'

// Interface for embedded product event data
interface EmbeddedProductEvent {
	kind: number
	id?: string
	pubkey?: string
	content?: string
	tags?: string[][]
	created_at?: number
}

// Helper to try parsing content as an embedded product event
const tryParseEmbeddedProduct = (content: string): EmbeddedProductEvent | null => {
	if (!content || content.trim() === '') return null

	try {
		const parsed = JSON.parse(content)

		// Check if it looks like a product event (kind 30402)
		if (parsed && typeof parsed === 'object') {
			// Direct kind 30402 event
			if (parsed.kind === 30402) {
				return parsed as EmbeddedProductEvent
			}

			// Check for product-like tags structure (has title, price, d tags)
			if (Array.isArray(parsed.tags)) {
				const hasTitle = parsed.tags.some((t: string[]) => t[0] === 'title')
				const hasPrice = parsed.tags.some((t: string[]) => t[0] === 'price')
				const hasDTag = parsed.tags.some((t: string[]) => t[0] === 'd')

				if (hasTitle && hasPrice && hasDTag) {
					return { ...parsed, kind: 30402 } as EmbeddedProductEvent
				}
			}
		}
	} catch {
		// Not valid JSON, return null
	}

	return null
}

// Helper functions to extract tag information
const getTags = (event: NDKEvent, tagName: string): string[][] => {
	return event.tags.filter((tag) => tag[0] === tagName)
}

const getTagValue = (
	event: NDKEvent,
	tagName: string,
	tagIndex: number = 0, // Which occurrence of the tag (if multiple)
	valueIndex: number = 1, // Which value within the tag array (usually 1 for the first actual value)
): string | undefined => {
	const tags = getTags(event, tagName)
	return tags[tagIndex]?.[valueIndex]
}

interface ChatMessageBubbleProps {
	event: NDKEvent
	isCurrentUser: boolean
}

// Component to display a single order item with product details
const OrderItem = ({ itemTag }: { itemTag: string[] }) => {
	const itemName = itemTag[0] || 'Unknown Item'
	const aTag = itemTag[1]
	const quantity = itemTag[2] || '1'

	const coords = getCoordsFromATag(aTag)
	const pubkey = coords?.pubkey
	const productId = coords.identifier

	const product = fetchProductByATag(coords.pubkey, coords.identifier)

	const { data: title = 'Untitled Product' } = useProductTitle(productId)
	const { data: priceTag } = useProductPrice(productId)
	const { data: images = [] } = useProductImages(productId)
	const price = priceTag ? `${priceTag[1]} ${priceTag[2]}` : null

	return (
		<li className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
			{images.length > 0 && (
				<LazyImage
					src={images[0][1]}
					alt={title || 'Product image'}
					className="object-cover object-center"
					containerClassName="h-12 w-12 flex-shrink-0 rounded-md border bg-gray-100"
					aspectRatio=""
					lazy={false}
				/>
			)}

			<div className="flex-1 min-w-0">
				<p className="font-medium text-sm truncate">{title}</p>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<span>Qty: {quantity}</span>
					{price && (
						<>
							<span>•</span>
							<span>{price}</span>
						</>
					)}
				</div>
			</div>
		</li>
	)
}

// --- Sub-components for different message types ---

// Component to display an embedded product from a Kind-16 message
const EmbeddedProductMessage = ({ productData }: { productData: EmbeddedProductEvent }) => {
	// Extract product info from tags
	const tags = productData.tags || []
	const title = tags.find((t) => t[0] === 'title')?.[1] || 'Untitled Product'
	const priceTag = tags.find((t) => t[0] === 'price')
	const price = priceTag ? `${priceTag[1]} ${priceTag[2] || 'SATS'}` : null
	const images = tags.filter((t) => t[0] === 'image')
	const imageUrl = images.length > 0 ? images[0][1] : null
	const productId = tags.find((t) => t[0] === 'd')?.[1]
	const description = productData.content || ''

	return (
		<div className="text-sm space-y-2">
			<div className="flex items-center font-semibold mb-1 text-blue-600">
				<PackageIcon className="w-4 h-4 mr-2 flex-shrink-0" />
				Shared Product
			</div>

			<div className="flex gap-3 p-2 bg-gray-50 rounded-md border border-gray-200">
				{imageUrl && (
					<LazyImage
						src={imageUrl}
						alt={title}
						className="object-cover"
						containerClassName="w-16 h-16 flex-shrink-0 rounded-md bg-gray-100"
						aspectRatio=""
						lazy={false}
					/>
				)}

				<div className="flex-1 min-w-0">
					<p className="font-medium text-sm truncate">{title}</p>
					{price && <p className="text-xs text-muted-foreground mt-0.5">{price}</p>}
					{description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{description}</p>}
				</div>
			</div>

			{productId && (
				<Link to={`/products/${productId}`} className="inline-flex items-center text-xs text-blue-600 hover:text-blue-800 hover:underline">
					View Product →
				</Link>
			)}
		</div>
	)
}

const OrderCreationMessage = ({ event }: { event: NDKEvent }) => {
	const orderId = getTagValue(event, 'order')
	const amount = getTagValue(event, 'amount')
	const items = getTags(event, 'item')
	const shipping = getTagValue(event, 'shipping')
	const address = getTagValue(event, 'address')
	const email = getTagValue(event, 'email')
	const phone = getTagValue(event, 'phone')

	return (
		<div className="text-sm space-y-1">
			<div className="flex items-center font-semibold mb-1">
				<ShoppingCartIcon className="w-4 h-4 mr-2 flex-shrink-0" />
				Order Placed
			</div>
			{orderId && (
				<p className="break-all">
					<strong>Order ID:</strong> {orderId}
				</p>
			)}
			{amount && (
				<p>
					<strong>Amount:</strong> {amount} sats
				</p>
			)}
			{items.length > 0 && (
				<div>
					<strong>Items:</strong>
					<ul className="list-disc list-inside pl-2 text-xs space-y-0.5">
						{items.map((item, idx) => (
							<OrderItem key={idx} itemTag={item} />
						))}
					</ul>
				</div>
			)}
			{shipping && (
				<p className="text-xs mt-1 break-words">
					<strong>Shipping:</strong> {shipping}
				</p>
			)}
			{address && (
				<p className="text-xs break-words">
					<strong>Address:</strong> {address}
				</p>
			)}
			{email && (
				<p className="text-xs break-all">
					<strong>Email:</strong> {email}
				</p>
			)}
			{phone && (
				<p className="text-xs break-all">
					<strong>Phone:</strong> {phone}
				</p>
			)}
		</div>
	)
}

const PaymentRequestMessage = ({ event }: { event: NDKEvent }) => {
	const orderId = getTagValue(event, 'order')
	const amount = getTagValue(event, 'amount')
	const paymentOptions = getTags(event, 'payment')
	const expiration = getTagValue(event, 'expiration')

	return (
		<div className="text-sm space-y-1">
			<div className="flex items-center font-semibold mb-1">
				<CreditCardIcon className="w-4 h-4 mr-2 flex-shrink-0" />
				Payment Request
			</div>
			{orderId && (
				<p>
					<strong>Order ID:</strong> {orderId}
				</p>
			)}
			{amount && (
				<p>
					<strong>Amount:</strong> {amount} sats
				</p>
			)}
			{paymentOptions.length > 0 && (
				<div>
					<strong>Payment Options:</strong>
					<ul className="list-disc list-inside pl-2 text-xs">
						{paymentOptions.map((opt, idx) => (
							<li key={idx}>{`${opt[1]}: ${opt[2]}`}</li>
						))}
					</ul>
				</div>
			)}
			{expiration && (
				<p className="text-xs mt-1">
					<strong>Expires:</strong> {format(new Date(parseInt(expiration) * 1000), 'Pp')}
				</p>
			)}
		</div>
	)
}

const OrderStatusUpdateMessage = ({ event }: { event: NDKEvent }) => {
	const orderId = getTagValue(event, 'order')
	const status = getTagValue(event, 'status')

	return (
		<div className="text-sm space-y-1">
			<div className="flex items-center font-semibold mb-1">
				<ClipboardListIcon className="w-4 h-4 mr-2 flex-shrink-0" />
				Order Status Update
			</div>
			{orderId && (
				<p>
					<strong>Order ID:</strong> {orderId}
				</p>
			)}
			{status && (
				<p>
					<strong>Status:</strong> <span className="font-medium">{status.toUpperCase()}</span>
				</p>
			)}
		</div>
	)
}

const ShippingUpdateMessage = ({ event }: { event: NDKEvent }) => {
	const orderId = getTagValue(event, 'order')
	const status = getTagValue(event, 'status')
	const tracking = getTagValue(event, 'tracking')
	const carrier = getTagValue(event, 'carrier')
	const eta = getTagValue(event, 'eta')

	return (
		<div className="text-sm space-y-1">
			<div className="flex items-center font-semibold mb-1">
				<PackageCheckIcon className="w-4 h-4 mr-2 flex-shrink-0" />
				Shipping Update
			</div>
			{orderId && (
				<p>
					<strong>Order ID:</strong> {orderId}
				</p>
			)}
			{status && (
				<p>
					<strong>Status:</strong> {status.toUpperCase()}
				</p>
			)}
			{tracking && (
				<p className="text-xs mt-1">
					<strong>Tracking:</strong> {tracking}
				</p>
			)}
			{carrier && (
				<p className="text-xs">
					<strong>Carrier:</strong> {carrier}
				</p>
			)}
			{eta && (
				<p className="text-xs">
					<strong>ETA:</strong> {format(new Date(parseInt(eta) * 1000), 'Pp')}
				</p>
			)}
		</div>
	)
}

const PaymentReceiptMessage = ({ event }: { event: NDKEvent }) => {
	const orderId = getTagValue(event, 'order')
	const amount = getTagValue(event, 'amount')
	const payments = getTags(event, 'payment')

	return (
		<div className="text-sm space-y-1">
			<div className="flex items-center font-semibold mb-1">
				<ReceiptIcon className="w-4 h-4 mr-2 flex-shrink-0" />
				Payment Receipt
			</div>
			{orderId && (
				<p>
					<strong>Order ID:</strong> {orderId}
				</p>
			)}
			{amount && (
				<p>
					<strong>Amount:</strong> {amount} sats
				</p>
			)}
			{payments.length > 0 && (
				<div>
					<strong>Proof:</strong>
					<ul className="list-disc list-inside pl-2 text-xs">
						{payments.map((p, idx) => (
							<li key={idx}>{`${p[1]}: ${p[3] ? `${p[2]} (${p[3]})` : p[2]}`}</li>
						))}
					</ul>
				</div>
			)}
		</div>
	)
}

// --- Main ChatMessageBubble component ---

export function ChatMessageBubble({ event, isCurrentUser }: ChatMessageBubbleProps) {
	const alignment = isCurrentUser ? 'justify-end' : 'justify-start'
	const bubbleStyles = isCurrentUser ? 'bg-gray-50 border border-black text-off-black' : 'bg-muted'
	const authorPubkey = event.pubkey
	const showAvatar = !isCurrentUser

	const renderStructuredContent = () => {
		if (event.kind === 14) {
			return null // Kind 14 content is handled directly
		}

		const messageType = getTagValue(event, 'type')

		if (event.kind === 16) {
			switch (messageType) {
				case '1':
					return <OrderCreationMessage event={event} />
				case '2':
					return <PaymentRequestMessage event={event} />
				case '3':
					return <OrderStatusUpdateMessage event={event} />
				case '4':
					return <ShippingUpdateMessage event={event} />
				default: {
					// Check if content contains an embedded product event
					const embeddedProduct = tryParseEmbeddedProduct(event.content)
					if (embeddedProduct) {
						return <EmbeddedProductMessage productData={embeddedProduct} />
					}

					return (
						<div className="text-sm flex items-center">
							<AlertCircleIcon className="w-4 h-4 mr-2 flex-shrink-0 text-orange-500" />
							Unsupported Kind 16 (type: {messageType || 'unknown'})
						</div>
					)
				}
			}
		}

		if (event.kind === 17) {
			return <PaymentReceiptMessage event={event} />
		}

		return (
			<div className="text-sm flex items-center">
				<AlertCircleIcon className="w-4 h-4 mr-2 flex-shrink-0 text-red-500" />
				Unsupported Message Kind ({event.kind})
			</div>
		)
	}

	const structuredPart = renderStructuredContent()
	const hasContent = event.content && event.content.trim() !== ''

	return (
		<div className={`flex flex-wrap items-end gap-2 ${alignment} mb-2 w-full`}>
			<div className="flex flex-col max-w-[85%] sm:max-w-[75%] md:max-w-[65%] lg:max-w-[55%] min-w-0">
				<div className={`px-3 py-2 rounded-lg shadow ${bubbleStyles} break-words`}>
					{structuredPart}
					{event.kind === 14 && hasContent && <p className="text-sm">{event.content}</p>}
					{event.kind === 14 && !hasContent && (
						<p className="text-sm italic text-muted-foreground/70 flex items-center">
							<MessageSquareIcon className="w-3 h-3 mr-1 flex-shrink-0" />
							(Empty message)
						</p>
					)}
					{event.kind !== 14 && hasContent && !tryParseEmbeddedProduct(event.content) && (
						<p className={`text-sm ${structuredPart ? 'mt-2 pt-2 border-t border-opacity-20' : ''}`}>
							{event.content} {/* Notes for Kind 16/17 */}
						</p>
					)}
					{!structuredPart && !hasContent && event.kind !== 14 && (
						<p className="text-sm italic text-muted-foreground/70">(No displayable content for this message type)</p>
					)}
				</div>
				{event.created_at && (
					<span className={`text-xs text-muted-foreground mt-1 px-1 ${isCurrentUser ? 'text-right' : 'text-left'}`}>
						{format(new Date(event.created_at * 1000), 'p')}
					</span>
				)}
			</div>
		</div>
	)
}
