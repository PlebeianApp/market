import React from 'react'

interface Product {
	id: string
	title: string
	price: number
	currency?: string
	image: string
	vendor?: string
	rating?: number
	badge?: string
	badgeColor?: string
}

export interface ProductGridLargeProps {
	products: Product[]
	columnsDesktop?: number
	columnsTablet?: number
	columnsMobile?: number
	showQuickAdd?: boolean
	showVendor?: boolean
	showRating?: boolean
	sort?: 'default' | 'price_asc' | 'price_desc' | 'newest'
}

export const ProductGridLarge: React.FC<ProductGridLargeProps> = ({
	products,
	columnsDesktop = 3,
	columnsTablet = 2,
	columnsMobile = 1,
	showQuickAdd = true,
	showVendor = true,
	showRating = true,
	sort = 'default',
}) => {
	// Simple sorting logic (in a real app, this would be handled by backend/state)
	const sortedProducts = [...products].sort((a, b) => {
		if (sort === 'price_asc') return a.price - b.price
		if (sort === 'price_desc') return b.price - a.price
		return 0
	})

	const gridCols = `
    grid-cols-${columnsMobile} 
    md:grid-cols-${columnsTablet} 
    lg:grid-cols-${columnsDesktop}
  `.replace(/grid-cols-\d+/g, (match) => match.replace('grid-cols-', ''))

	return (
		<div className="py-12 px-6 max-w-7xl mx-auto">
			<div className={`grid gap-8 ${gridCols}`}>
				{sortedProducts.map((product) => (
					<div
						key={product.id}
						className="group relative bg-white rounded-lg shadow-sm hover:shadow-lg transition-shadow duration-300 overflow-hidden border border-gray-100"
					>
						{/* Badge */}
						{product.badge && (
							<div
								className="absolute top-3 left-3 z-10 px-3 py-1 text-xs font-bold text-white rounded-full"
								style={{ backgroundColor: product.badgeColor || '#ef4444' }}
							>
								{product.badge}
							</div>
						)}

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
							{showVendor && product.vendor && <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{product.vendor}</p>}
							<h3 className="text-lg font-semibold text-gray-900 mb-2 truncate">
								<a href={`/product/${product.id}`} className="hover:text-orange-600 transition-colors">
									{product.title}
								</a>
							</h3>

							{showRating && product.rating && (
								<div className="flex items-center mb-2">
									{[...Array(5)].map((_, i) => (
										<svg
											key={i}
											className={`w-4 h-4 ${i < product.rating! ? 'text-yellow-400' : 'text-gray-300'}`}
											fill="currentColor"
											viewBox="0 0 20 20"
										>
											<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
										</svg>
									))}
								</div>
							)}

							<p className="text-lg font-bold text-gray-900">
								{product.currency || '$'}
								{product.price.toFixed(2)}
							</p>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
