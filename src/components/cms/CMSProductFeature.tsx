// src/components/cms/CMSProductFeature.tsx
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProductData } from '@/hooks/useProductData'
import type { DataSource } from '@/components/editor/DataSourceField'
import { CMSProductCard } from './CMSProductCard'
import React from 'react'

export interface CMSProductFeatureProps {
	dataSource?: DataSource
	backgroundImage?: string
	backgroundColor?: string
	overlayOpacity?: number
	height?: string
	className?: string
}

export const CMSProductFeature: React.FC<CMSProductFeatureProps> = ({
	dataSource,
	backgroundImage = '',
	backgroundColor = '',
	overlayOpacity = 0.4,
	height = '400px',
	className = '',
}) => {
	const { events, loading, error } = useProductData(dataSource)

	if (loading) {
		return <div className="py-12 text-center text-muted-foreground">Loading product...</div>
	}

	if (error) {
		return <div className="py-12 text-center text-destructive">{error}</div>
	}

	if (!events || events.length === 0) {
		return <div className="py-12 text-center text-muted-foreground">No product found.</div>
	}

	const product = events[0]

	return (
		<div
			className={`relative w-full ${className}`}
			style={{
				backgroundImage: backgroundImage ? `url(${backgroundImage})` : backgroundColor ? `none` : 'none',
				backgroundColor: backgroundColor && !backgroundImage ? backgroundColor : 'transparent',
				backgroundSize: 'cover',
				backgroundPosition: 'center',
				backgroundRepeat: 'no-repeat',
				height: height,
			}}
		>
			{/* Overlay */}
			<div
				className="absolute inset-0"
				style={{
					backgroundColor: 'black',
					opacity: overlayOpacity,
				}}
			></div>

			<div className="absolute inset-0 overflow-hidden flex items-center">
				<div className="max-w-7xl mx-auto px-6 w-full">
					<div className="flex items-center gap-8">
						{/* Product Image */}
						<div className="flex-shrink-0 flex items-center h-full p-4">
							<div className="bg-card border rounded-lg overflow-hidden shadow-lg">
								<img
									src={product.tags.find((tag) => tag[0] === 'image')?.[1] || '/placeholder.jpg'}
									alt={product.tags.find((tag) => tag[0] === 'title')?.[1] || 'Product'}
									className="h-full max-h-full w-auto object-contain"
									style={{ maxHeight: '300px' }}
								/>
							</div>
						</div>

						{/* Product Content */}
						<div className="flex-1 text-center lg:text-left min-w-0">
							<CMSProductCard
								product={product}
								contentOnly={true}
								showVendor={true}
								showDescriptionSnippet={true}
								showPrice={true}
								className="dark"
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
