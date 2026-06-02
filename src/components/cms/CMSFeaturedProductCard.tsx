import { useProductData } from '@/hooks/useProductData'
import { FeaturedProductCardBase } from './CMSFeaturedProductCardBase'
import type { DataSource } from '@/components/editor/DataSourceField'

export interface CMSFeaturedProductCardProps {
  dataSource?: DataSource
  showPrice?: boolean
  showDimensions?: boolean
  showDescriptionSnippet?: boolean
}

export const CMSFeaturedProductCard: React.FC<CMSFeaturedProductCardProps> = ({
  dataSource,
  showPrice = true,
  showDescriptionSnippet = true
}) => {
  const { items, loading, error } = useProductData(dataSource)

  return (
    <FeaturedProductCardBase
      items={items}
      loading={loading}
      error={error || undefined}
      showPrice={showPrice}
      showDescriptionSnippet={showDescriptionSnippet}
    />
  )
}