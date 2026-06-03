// src/components/cms/CMSFeatureBanner.tsx
import React from 'react'
import { Button } from '@/components/ui/button'

export interface CMSFeatureBannerProps {
	backgroundImage?: string
	imageSrc?: string
	title: string
	description: string
	ctaText?: string
	ctaLink?: string
	ctaVariant?: 'default' | 'secondary' | 'outline'
	imagePosition?: 'left' | 'right'
	textAlignment?: 'left' | 'center' | 'right'
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
	ctaVariant = 'default',
	imagePosition = 'left',
	textAlignment = 'left',
	height = '400px',
	overlayOpacity = 0.4,
	className = '',
}) => {
	const getCtaVariant = () => {
		switch (ctaVariant) {
			case 'secondary':
				return 'secondary'
			case 'outline':
				return 'outline'
			default:
				return 'default'
		}
	}

	// Get the appropriate CSS class for text alignment
	const getTextAlignmentClass = () => {
		switch (textAlignment) {
			case 'center':
				return 'text-center items-center'
			case 'right':
				return 'text-right items-end'
			default:
				return 'text-left items-start'
		}
	}

	// Get the appropriate flex direction based on image position
	const getFlexDirection = () => {
		return imagePosition === 'right' ? 'flex-row-reverse' : 'flex-row'
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
			{/* Overlay - only show if there's a background image */}
			{backgroundImage && (
				<div
					className="absolute inset-0"
					style={{
						backgroundColor: 'black',
						opacity: overlayOpacity,
					}}
				></div>
			)}

			<div className="absolute inset-0 overflow-hidden flex items-center">
				<div className="max-w-7xl mx-auto px-6 w-full">
					<div className={`flex ${getFlexDirection()} items-center gap-8`}>
						{/* Image (Optional) */}
						{imageSrc && (
							<div className="flex-shrink-0 flex items-center h-full p-4">
								<img src={imageSrc} alt={title} className="h-full max-h-full w-auto object-contain rounded-lg" />
							</div>
						)}

						{/* Content Area */}
						<div className={`flex-1 ${imageSrc ? '' : 'w-full'} ${backgroundImage ? 'dark' : ''}`}>
							<div className={`flex flex-col ${getTextAlignmentClass()} h-full justify-center`}>
								{/* Title */}
								{title && <h2 className="text-3xl md:text-4xl font-heading tracking-wider text-foreground mb-4">{title}</h2>}

								{/* Description */}
								{description && <p className="text-lg text-muted-foreground mb-8 max-w-2xl">{description}</p>}

								{/* CTA Button */}
								{ctaText && (
									<div className={textAlignment === 'center' ? 'flex justify-center' : textAlignment === 'right' ? 'flex justify-end' : ''}>
										<Button asChild variant={getCtaVariant()}>
											<a href={ctaLink}>{ctaText}</a>
										</Button>
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
