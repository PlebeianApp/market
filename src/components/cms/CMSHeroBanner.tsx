import React from 'react'

export interface HeroBannerProps {
	backgroundImage?: string
	backgroundVideo?: string
	headline: string
	subheadline?: string
	ctaButton?: {
		text: string
		link: string
		variant?: 'primary' | 'secondary' | 'outline'
	}
	alignment?: 'left' | 'center' | 'right'
	overlayOpacity?: number
	minHeight?: string
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
	backgroundImage,
	backgroundVideo,
	headline,
	subheadline,
	ctaButton,
	alignment = 'center',
	overlayOpacity = 0.4,
	minHeight = '100vh',
}) => {
	const alignmentClasses = {
		left: 'items-start text-left',
		center: 'items-center text-center',
		right: 'items-end text-right',
	}

	const buttonVariants = {
		primary: 'bg-orange-500 hover:bg-orange-600 text-white',
		secondary: 'bg-gray-800 hover:bg-gray-700 text-white',
		outline: 'border-2 border-white hover:bg-white hover:text-gray-900 text-white',
	}

	return (
		<div className={`relative w-full flex flex-col ${alignmentClasses[alignment]} justify-center`} style={{ minHeight }}>
			{/* Background Layer */}
			<div className="absolute inset-0 z-0 overflow-hidden">
				{backgroundVideo && (
					<video autoPlay muted loop playsInline className="w-full h-full object-cover">
						<source src={backgroundVideo} type="video/mp4" />
					</video>
				)}
				{backgroundImage && !backgroundVideo && <img src={backgroundImage} alt="Hero background" className="w-full h-full object-cover" />}
				{/* Overlay */}
				<div className="absolute inset-0 bg-black" style={{ opacity: overlayOpacity }} />
			</div>

			{/* Content Layer */}
			<div className="relative z-10 px-6 py-12 md:px-12 lg:px-24 max-w-7xl mx-auto w-full">
				<h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-4 leading-tight">{headline}</h1>

				{subheadline && <p className="text-lg md:text-xl lg:text-2xl text-gray-100 mb-8 max-w-2xl">{subheadline}</p>}

				{ctaButton && (
					<a
						href={ctaButton.link}
						className={`inline-block px-8 py-3 rounded-md font-semibold transition-all duration-300 ${buttonVariants[ctaButton.variant || 'primary']}`}
					>
						{ctaButton.text}
					</a>
				)}
			</div>
		</div>
	)
}
