import React from 'react'

export interface FeaturedProductCardProps {
	product: {
		id: string
		title: string
		price: number
		currency?: string
		image: string
		dimensions?: string
		description?: string
		badge?: string
		badgeColor?: string
	}
	showPrice?: boolean
	showDimensions?: boolean
	showDescriptionSnippet?: boolean
}

export const FeaturedProductCard: React.FC<FeaturedProductCardProps> = ({
	product,
	showPrice = true,
	showDimensions = true,
	showDescriptionSnippet = true,
}) => {
	return (
		<div className="relative group bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100 max-w-md mx-auto">
			{/* Badge */}
			{product.badge && (
				<div
					className="absolute top-4 right-4 z-10 px-3 py-1 text-xs font-bold text-white rounded-full shadow-md"
					style={{ backgroundColor: product.badgeColor || '#f97316' }}
				>
					{product.badge}
				</div>
			)}

			{/* Image Container */}
			<div className="relative aspect-square overflow-hidden bg-gray-50">
				<img
					src={product.image}
					alt={product.title}
					className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-700"
				/>
				<div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
			</div>

			{/* Content */}
			<div className="p-6">
				<h3 className="text-2xl font-bold text-gray-900 mb-2">
					<a href={`/product/${product.id}`} className="hover:text-orange-600 transition-colors">
						{product.title}
					</a>
				</h3>

				{showDimensions && product.dimensions && <p className="text-sm text-gray-500 mb-3 font-medium">{product.dimensions}</p>}

				{showDescriptionSnippet && product.description && <p className="text-gray-600 mb-4 line-clamp-3">{product.description}</p>}

				{showPrice && (
					<div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
						<span className="text-2xl font-bold text-gray-900">
							{product.currency || '$'}
							{product.price.toFixed(2)}
						</span>
						<a
							href={`/product/${product.id}`}
							className="px-6 py-2 bg-gray-900 text-white rounded-md font-medium hover:bg-orange-600 transition-colors"
						>
							View Details
						</a>
					</div>
				)}
			</div>
		</div>
	)
}
