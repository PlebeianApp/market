import { useEffect, useState } from 'react'
import { ndkActions } from '@/lib/stores/ndk'
import type { DataSource } from '@/components/editor/DataSourceField'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

export const useProductData = (dataSource?: DataSource) => {
	const [events, setEvents] = useState<NDKEvent[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const fetchData = async () => {
			setLoading(true)
			setError(null)

			try {
				const ndk = ndkActions.getNDK()!

				if (!dataSource) {
					setEvents([])
					return
				}

				let events: NDKEvent[] = []

				if (dataSource.type === 'static') {
					// Fetch by specific IDs
					if (dataSource.ids && dataSource.ids.length > 0) {
						const filter = {
							kinds: [30402], // Product listings
							ids: dataSource.ids,
						}
						const fetchedEvents = await ndk.fetchEvents(filter)
						events = Array.from(fetchedEvents)
					}
				} else if (dataSource.type === 'dynamic') {
					// Build filter based on dynamic settings
					const filter: any = {
						kinds: [dataSource.kind || 30402],
						limit: dataSource.limit || 12,
					}

					if (dataSource.authors && dataSource.authors.length > 0) {
						filter.authors = dataSource.authors
					}

					// Apply tag filters
					if (dataSource.tags && dataSource.tags.length > 0) {
						dataSource.tags.forEach((tag) => {
							const tagName = tag[0]
							const tagValue = tag[1]
							if (tagName && tagValue) {
								filter[`#${tagName}`] = [tagValue]
							}
						})
					}

					const fetchedEvents = await ndk.fetchEvents(filter)
					events = Array.from(fetchedEvents)
				}

				setEvents(events)
			} catch (err) {
				console.error('Failed to fetch product data:', err)
				setError('Failed to load product data')
			} finally {
				setLoading(false)
			}
		}

		fetchData()
	}, [JSON.stringify(dataSource)])

	return { events, loading, error }
}
