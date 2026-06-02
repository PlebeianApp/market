// src/components/cms/CMSFeatureBanner.tsx
import React from 'react'

export interface CMSFeatureBannerProps {
	backgroundImage?: string
	imageSrc?: string
	title: string
	description: string
	ctaText?: string
	ctaLink?: string
	ctaVariant?: 'primary' | 'secondary' | 'outline'
	height?: string
	overlayOpacity?: number
	className?: string
}

export const CMSFeatureBanner: React.FC<CMSFeatureBannerProps> = ({
	backgroundImage = '',
	imageSrc = '',
	title = '',
	description = '',
	ctaText = '',
	ctaLink = '#',
	ctaVariant = 'primary',
	height = '400px',
	overlayOpacity = 0.4,
	className = '',
}) => {
	const getCtaButtonClass = () => {
		switch (ctaVariant) {
			case 'primary':
				return 'bg-primary text-primary-foreground hover:bg-primary/90'
			case 'secondary':
				return 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
			case 'outline':
				return 'bg-transparent border border-input hover:bg-accent text-accent-foreground'
			default:
				return 'bg-primary text-primary-foreground hover:bg-primary/90'
		}
	}

	return (
		<div
			className={`relative w-full ${className}`}
			style={{
				backgroundImage: backgroundImage ? `url(${backgroundImage})` : 'none',
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
						{imageSrc && (
							<div className="flex-shrink-0 flex items-center h-full p-4">
								<img src={imageSrc} alt={title} className="h-full max-h-full w-auto object-contain rounded-lg shadow-lg" />
							</div>
						)}

						{/* Content Area */}
						<div className="flex-1 text-center lg:text-left min-w-0">
							<h2 className="text-3xl md:text-4xl font-heading tracking-wider text-white mb-4">{title}</h2>
							<p className="text-lg text-white/90 mb-8 max-w-2xl">{description}</p>

							{/* CTA moved inline with content */}
							{ctaText && (
								<a
									href={ctaLink}
									className={`inline-flex items-center px-6 py-3 rounded-md font-medium transition-colors ${getCtaButtonClass()}`}
								>
									{ctaText}
								</a>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
