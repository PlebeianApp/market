import React from 'react'

export interface SplitFeatureProps {
	imageSrc: string
	imagePosition?: 'left' | 'right'
	title: string
	description: string
	ctaLink?: string
	ctaText?: string
	verticalAlignment?: 'top' | 'middle' | 'bottom'
}

export const SplitFeature: React.FC<SplitFeatureProps> = ({
	imageSrc,
	imagePosition = 'left',
	title,
	description,
	ctaLink,
	ctaText = 'Learn More',
	verticalAlignment = 'middle',
}) => {
	const isLeft = imagePosition === 'left'

	const alignClasses = {
		top: 'items-start',
		middle: 'items-center',
		bottom: 'items-end',
	}

	return (
		<div className={`flex flex-col md:flex-row ${alignClasses[verticalAlignment]} gap-8 md:gap-12 py-16 px-6 md:px-12 max-w-7xl mx-auto`}>
			{/* Image Section */}
			<div className={`w-full md:w-1/2 ${isLeft ? 'order-1' : 'order-2'}`}>
				<div className="relative overflow-hidden rounded-lg shadow-lg">
					<img
						src={imageSrc}
						alt={title}
						className="w-full h-auto object-cover transform hover:scale-105 transition-transform duration-500"
					/>
				</div>
			</div>

			{/* Text Section */}
			<div className={`w-full md:w-1/2 ${isLeft ? 'order-2' : 'order-1'} flex flex-col justify-center`}>
				<h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">{title}</h2>
				<div className="text-gray-600 mb-6 leading-relaxed prose max-w-none">
					<p>{description}</p>
				</div>

				{ctaLink && (
					<a
						href={ctaLink}
						className="inline-flex items-center text-orange-600 font-semibold hover:text-orange-700 transition-colors group"
					>
						{ctaText}
						<svg
							className="w-4 h-4 ml-2 transform group-hover:translate-x-1 transition-transform"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
						</svg>
					</a>
				)}
			</div>
		</div>
	)
}
