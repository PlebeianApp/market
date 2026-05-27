import React, { useState } from 'react'

interface GalleryImage {
	src: string
	alt: string
	isVideo?: boolean
	videoUrl?: string
}

export interface ProductGalleryProps {
	images: GalleryImage[]
	layout?: 'vertical' | 'horizontal'
	enableZoom?: boolean
	zoomType?: 'lens' | 'inner'
}

export const ProductGallery: React.FC<ProductGalleryProps> = ({ images, layout = 'vertical', enableZoom = true, zoomType = 'lens' }) => {
	const [activeIndex, setActiveIndex] = useState(0)
	const [isZoomed, setIsZoomed] = useState(false)

	const activeImage = images[activeIndex]

	const handleThumbnailClick = (index: number) => {
		setActiveIndex(index)
		setIsZoomed(false)
	}

	return (
		<div className="flex flex-col lg:flex-row gap-8">
			{/* Thumbnails */}
			<div className={`flex ${layout === 'vertical' ? 'flex-col gap-4' : 'flex-row gap-4 overflow-x-auto'} lg:w-24 lg:h-full`}>
				{images.map((img, index) => (
					<button
						key={index}
						onClick={() => handleThumbnailClick(index)}
						className={`relative flex-shrink-0 w-20 h-20 rounded-md overflow-hidden border-2 transition-all ${
							index === activeIndex ? 'border-orange-500 ring-2 ring-orange-200' : 'border-gray-200 hover:border-gray-400'
						}`}
					>
						{img.isVideo ? (
							<div className="w-full h-full bg-gray-100 flex items-center justify-center">
								<svg className="w-8 h-8 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
									<path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
								</svg>
							</div>
						) : (
							<img src={img.src} alt={img.alt} className="w-full h-full object-cover" />
						)}
					</button>
				))}
			</div>

			{/* Main Image */}
			<div className="flex-1 relative bg-gray-50 rounded-lg overflow-hidden aspect-square lg:aspect-auto lg:h-[600px]">
				{activeImage.isVideo && activeImage.videoUrl ? (
					<video src={activeImage.videoUrl} controls autoPlay loop className="w-full h-full object-contain" />
				) : (
					<div
						className={`w-full h-full relative ${enableZoom ? 'cursor-zoom-in' : ''}`}
						onMouseEnter={() => enableZoom && setIsZoomed(true)}
						onMouseLeave={() => setIsZoomed(false)}
					>
						<img
							src={activeImage.src}
							alt={activeImage.alt}
							className={`w-full h-full object-contain transition-transform duration-300 ${isZoomed && enableZoom ? 'scale-150 origin-center' : ''}`}
						/>
						{enableZoom && isZoomed && <div className="absolute inset-0 pointer-events-none border-2 border-orange-500/50" />}
					</div>
				)}
			</div>
		</div>
	)
}
