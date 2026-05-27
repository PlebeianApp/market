import React from 'react'
import type { CMSProductGridItem } from './CMSProductGridOld'

export interface ProductGridBaseProps {
	items: CMSProductGridItem[]
	loading: boolean
	error?: string
	columnsDesktop?: number
	columnsTablet?: number
	columnsMobile?: number
	showQuickAdd?: boolean
	showVendor?: boolean
}

export const ProductGridBase: React.FC<ProductGridBaseProps> = ({
	items,
	loading = false,
	error = undefined,
	columnsDesktop = 3,
	columnsTablet = 2,
	columnsMobile = 1,
	showQuickAdd = true,
	showVendor = true,
}) => {
	if (loading) {
		return <div className="py-12 text-center">Loading products...</div>
	}

	if (error) {
		return <div className="py-12 text-center">{error}</div>
	}

	if (items.length === 0) {
		return <div className="py-12 text-center text-gray-500">No products found matching your criteria.</div>
	}

	const gridCols = `
    grid-cols-${columnsMobile} 
    md:grid-cols-${columnsTablet} 
    lg:grid-cols-${columnsDesktop}
  `.replace(/grid-cols-\d+/g, (match) => match.replace('grid-cols-', ''))

	return (
		<div className="py-12 px-6 max-w-7xl mx-auto">
			<div className={`grid gap-8 ${gridCols}`}>
				{items.map((product) => (
					<div
						key={product.id}
						className="group relative bg-white rounded-lg shadow-sm hover:shadow-lg transition-shadow duration-300 overflow-hidden border border-gray-100"
					>
						{/* Badge */}

						{/*product.badge && (
                            <div
                                className="absolute top-3 left-3 z-10 px-3 py-1 text-xs font-bold text-white rounded-full"
                                style={{ backgroundColor: product.badgeColor || '#ef4444' }}
                            >
                                {product.badge}
                            </div>
                        )*/}

						{/* Image */}
						<div className="relative aspect-square overflow-hidden bg-gray-100">
							<img
								src={product.image}
								alt={product.title}
								className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500"
							/>

							{/* Quick Add Button */}
							{showQuickAdd && (
								<button className="absolute bottom-4 left-1/2 -translate-x-1/2 translate-y-12 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300 bg-white text-gray-900 px-4 py-2 rounded-md font-medium shadow-md hover:bg-gray-50">
									Quick Add
								</button>
							)}
						</div>

						{/* Content */}
						<div className="p-4">
							{showVendor && product.pubkey && <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{product.pubkey}</p>}
							<h3 className="text-lg font-semibold text-gray-900 mb-2 truncate">
								<a href={`/product/${product.id}`} className="hover:text-orange-600 transition-colors">
									{product.title}
								</a>
							</h3>

							<p className="text-lg font-bold text-gray-900">
								{product.currency || '$'}
								{product.price}
							</p>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
