import { useEffect, useState } from 'react'
import { ndkActions } from '@/lib/stores/ndk'
import type { DataSource } from '@/components/editor/DataSourceField'
import type { CMSProductGridItem } from '@/components/cms/CMSProductGridItem'
import { CMSProductGridItem as ProductGridItem } from '@/components/cms/CMSProductGridItem'

export const useProductData = (dataSource?: DataSource) => {
  const [items, setItems] = useState<CMSProductGridItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError(null)
      
      try {
        const ndk = ndkActions.getNDK()!
        
        if (!dataSource) {
          setItems([])
          return
        }

        let events: any[] = []
        
        if (dataSource.type === 'static') {
          // Fetch by specific IDs
          if (dataSource.ids && dataSource.ids.length > 0) {
            events = Array.from(await ndk.fetchEvents({ ids: dataSource.ids }))
          }
        } else if (dataSource.type === 'dynamic') {
          // Build filter based on dynamic settings
          const filter: any = {
            kinds: [dataSource.kind || 30402],
            limit: dataSource.limit || 12
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
          
          events = Array.from(await ndk.fetchEvents(filter))
        }
        
        setItems(ProductGridItem.fromEvents(events))
      } catch (err) {
        console.error('Failed to fetch product data:', err)
        setError('Failed to load product data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [JSON.stringify(dataSource)])

  return { items, loading, error }
}