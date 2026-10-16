export interface Nip15ProductData {
	id: string
	name: string
	description: string
	price: string
	currency: string
	quantity: number | null
	images: string[]
	specs: Array<[string, string]>
	stall_id?: string
}

/** Reads a NIP-15 product (kind 30018); falls back to the d tag and raw content when the JSON is malformed. */
export function parseNip15Product(event: { content: string; tags: string[][] }): Nip15ProductData {
	const fallback: Nip15ProductData = {
		id: '',
		name: '',
		description: '',
		price: '0',
		currency: 'USD',
		quantity: null,
		images: [],
		specs: [],
	}

	try {
		const content = JSON.parse(event.content)
		return {
			id: content.id || '',
			name: content.name || '',
			description: content.description || '',
			price: content.price?.toString() || '0',
			currency: content.currency || 'USD',
			quantity: content.quantity ?? null,
			images: content.images || [],
			specs: content.specs || [],
			stall_id: content.stall_id,
		}
	} catch (error) {
		console.error('Failed to parse NIP-15 event content:', error)
		return {
			...fallback,
			id: event.tags.find((tag) => tag[0] === 'd')?.[1] || '',
			description: event.content || '',
		}
	}
}
