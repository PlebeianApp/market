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
