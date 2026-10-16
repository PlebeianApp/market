export interface ProductSearchEvent {
	tags: string[][]
	content: string
	created_at?: number
}

export type ProductSearchSort = 'newest' | 'oldest'

/**
 * Applies the current search page's exclusion-term and date-ordering behavior
 * to results already fetched by the host application's search adapter.
 */
export function filterAndSortProductSearchResults<T extends ProductSearchEvent>(
	events: readonly T[],
	options: { exclude?: string; sort?: ProductSearchSort } = {},
): T[] {
	const excludeTerms = (options.exclude ?? '')
		.toLowerCase()
		.split(/\s+/)
		.filter((term) => term.length > 0)

	const filtered = excludeTerms.length
		? events.filter((event) => {
				const title = event.tags.find((tag) => tag[0] === 'title')?.[1]?.toLowerCase() || 'untitled product'
				const searchText = `${title} ${event.content?.toLowerCase() || ''}`
				return !excludeTerms.some((term) => searchText.includes(term))
			})
		: [...events]

	return filtered.sort((a, b) =>
		options.sort === 'oldest' ? (a.created_at || 0) - (b.created_at || 0) : (b.created_at || 0) - (a.created_at || 0),
	)
}
