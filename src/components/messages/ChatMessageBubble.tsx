import { useProductImages, useProductPrice, useProductTitle } from '@/queries/products'
import { getCoordsFromATag } from '@/lib/utils/coords'
import { ChatMessageBubbleView, ChatOrderItemView, type ChatMessageEvent } from '@ui/components/messages/ChatMessageBubbleView'

function OrderItem({ itemTag }: { itemTag: string[] }) {
	const quantity = itemTag[2] || '1'
	const productId = getCoordsFromATag(itemTag[1]).identifier

	const { data: title = 'Untitled Product' } = useProductTitle(productId)
	const { data: priceTag } = useProductPrice(productId)
	const { data: images = [] } = useProductImages(productId)

	return (
		<ChatOrderItemView
			title={title}
			quantity={quantity}
			price={priceTag ? `${priceTag[1]} ${priceTag[2]}` : null}
			imageUrl={images[0]?.[1]}
		/>
	)
}

interface ChatMessageBubbleProps {
	event: ChatMessageEvent
	isCurrentUser: boolean
}

export function ChatMessageBubble({ event, isCurrentUser }: ChatMessageBubbleProps) {
	return (
		<ChatMessageBubbleView
			event={event}
			isCurrentUser={isCurrentUser}
			renderOrderItem={(itemTag, index) => <OrderItem key={index} itemTag={itemTag} />}
		/>
	)
}
