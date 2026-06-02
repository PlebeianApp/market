import { useProductData } from '@/hooks/useProductData'
import { ProductGridBase } from './CMSProductGridBase'
import type { DataSource } from '@/components/editor/DataSourceField'

export interface CMSProductGridProps {
  dataSource?: DataSource
  columnsDesktop?: number
  columnsTablet?: number
  columnsMobile?: number
  showQuickAdd?: boolean
  showVendor?: boolean
}

export const CMSProductGrid: React.FC<CMSProductGridProps> = ({
  dataSource,
  columnsDesktop = 3,
  columnsTablet = 2,
  columnsMobile = 1,
  showQuickAdd = true,
  showVendor = true
}) => {
  const { items, loading, error } = useProductData(dataSource)

  return (
    <ProductGridBase
      items={items}
      loading={loading}
      error={error || undefined}
      columnsDesktop={columnsDesktop}
      columnsTablet={columnsTablet}
      columnsMobile={columnsMobile}
      showQuickAdd={showQuickAdd}
      showVendor={showVendor}
    />
  )
}