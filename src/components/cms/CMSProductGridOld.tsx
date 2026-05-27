import { ndkActions } from '@/lib/stores/ndk'
import { isValidUserProfile } from '@/lib/utils/userValidation'
import NDK, { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { useState, useEffect } from 'react'

interface Tag {
	[index: number]: string
}

export interface CMSProductGridItem {
	id: string
	pubkey: string
	title: string
	image?: string
	summary?: string
	price?: string
	currency?: string
	location?: string
	tags: Tag[]
	content: string
}
export namespace CMSProductGridItem {
	export function fromEvent(event: any): CMSProductGridItem {
		const titleTag = event.tags?.find((t: string[]) => t[0] === 'title')
		const imageTag = event.tags?.find((t: string[]) => t[0] === 'image')
		const summaryTag = event.tags?.find((t: string[]) => t[0] === 'summary')
		const priceTag = event.tags?.find((t: string[]) => t[0] === 'price')
		const locationTag = event.tags?.find((t: string[]) => t[0] === 'location')

		return {
			id: event.id,
			pubkey: event.pubkey,
			title: titleTag?.[1] || 'Untitled',
			image: imageTag?.[1],
			summary: summaryTag?.[1],
			price: priceTag?.[1],
			currency: priceTag?.[2],
			location: locationTag?.[1],
			tags: event.tags,
			content: event.content,
		}
	}

	export function fromEvents(events: any[]): CMSProductGridItem[] {
		return Array.from(events).map((e) => CMSProductGridItem.fromEvent(e))
	}
}

export interface CMSProductGridPropsOld {
	kind?: number // Default: 30402 for classified ads
	tags?: string[][] // Additional tag filters
	limit?: number
	author: string
	relayUrl?: string
}

export const CMSProductGridOld = ({ kind = 30402, tags = [], limit = 5, relayUrl, author }: CMSProductGridPropsOld) => {
	const [items, setItems] = useState<CMSProductGridItem[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const fetchItems = async () => {
			setItems([])
			setLoading(true)
			setError(null)

			try {
				const ndk = ndkActions.getNDK()!

				const filter: any = {
					kinds: [kind],
					limit,
				}

				if (author && isValidUserProfile(author)) {
					try {
						// Normalize identifier to pubkey
						const authorPubkey = await ndk.fetchUser(author).then((user) => user?.pubkey)
						filter.authors = [authorPubkey]
					} catch {}
				}

				// Add tag filters
				tags.forEach((tag) => {
					const tagName = tag[0]
					const tagValue = tag[1]
					if (tagName && tagValue) {
						filter[`#${tagName}`] = [tagValue]
					}
				})

				const events = await ndk.fetchEvents(filter)

				const parsedItems: CMSProductGridItem[] = Array.from(events).map((event) => {
					const titleTag = event.tags.find((t) => t[0] === 'title')
					const imageTag = event.tags.find((t) => t[0] === 'image')
					const summaryTag = event.tags.find((t) => t[0] === 'summary')
					const priceTag = event.tags.find((t) => t[0] === 'price')
					const locationTag = event.tags.find((t) => t[0] === 'location')

					return {
						id: event.id,
						pubkey: event.pubkey,
						title: titleTag?.[1] || 'Untitled',
						image: imageTag?.[1],
						summary: summaryTag?.[1],
						price: priceTag?.[1],
						currency: priceTag?.[2],
						location: locationTag?.[1],
						tags: event.tags,
						content: event.content,
					}
				})

				console.log('Items: ', parsedItems)

				setItems(parsedItems)
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to fetch items')
			} finally {
				setLoading(false)
			}
		}

		fetchItems()
	}, [kind, JSON.stringify(tags), limit, author, relayUrl])

	if (loading) return <div>Loading items...</div>
	if (error) return <div>Error: {error}</div>

	if (items.length === 0) {
		return <div>No items found</div>
	}

	return (
		<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			{items.map((item) => (
				<div key={item.id} className="border rounded-lg overflow-hidden hover:shadow-lg transition-shadow">
					{item.image && <img src={item.image} alt={item.title} className="w-full h-48 object-cover" />}
					<div className="p-4">
						<h3 className="font-semibold text-lg mb-2">{item.title}</h3>
						{item.summary && <p className="text-sm text-gray-600 mb-3 line-clamp-2">{item.summary}</p>}
						<div className="flex justify-between items-center text-sm">
							{item.price && (
								<span className="font-bold text-green-600">
									{item.price} {item.currency || 'USD'}
								</span>
							)}
							{item.location && <span className="text-gray-500">{item.location}</span>}
						</div>
					</div>
				</div>
			))}
		</div>
	)
}
