// src/components/cms/CMSSimpleHero.tsx
import React from 'react'
import { Button } from '@/components/ui/button'

export interface CMSSimpleHeroProps {
	backgroundImage?: string
	title: string
	subtitle?: string
	ctaText?: string
	ctaLink?: string
	textAlignment?: 'left' | 'center' | 'right'
	height?: string
	overlayOpacity?: number
	className?: string
}

export const CMSSimpleHero: React.FC<CMSSimpleHeroProps> = ({
	backgroundImage = '',
	title = '',
	subtitle = '',
	ctaText = '',
	ctaLink = '#',
	textAlignment = 'center',
	height = '500px',
	overlayOpacity = 0.4,
	className = '',
}) => {
	// Get the appropriate CSS class for text alignment
	const getTextAlignmentClass = () => {
		switch (textAlignment) {
			case 'left':
				return 'text-left items-start'
			case 'right':
				return 'text-right items-end'
			case 'center':
			default:
				return 'text-center items-center'
		}
	}

	return (
		<div
			className={`relative w-full overflow-hidden ${className}`}
			style={{
				backgroundImage: backgroundImage ? `url(${backgroundImage})` : 'none',
				backgroundSize: 'cover',
				backgroundPosition: 'center',
				backgroundRepeat: 'no-repeat',
				height: height,
			}}
		>
			{/* Overlay for better text readability - only show if there's a background image */}
			{backgroundImage && (
				<div
					className="absolute inset-0"
					style={{
						backgroundColor: 'black',
						opacity: overlayOpacity,
					}}
				></div>
			)}

			{/* Content Container - using same padding as other components */}
			<div className={`absolute inset-0 flex items-center ${backgroundImage ? 'dark' : ''}`}>
				<div className="w-full max-w-7xl mx-auto px-6">
					<div className={`flex flex-col ${getTextAlignmentClass()}`}>
						{/* Title */}
						{title && <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-4">{title}</h1>}

						{/* Subtitle */}
						{subtitle && <p className="text-xl text-muted-foreground mb-8 max-w-2xl">{subtitle}</p>}

						{/* CTA Button */}
						{ctaText && (
							<div className={textAlignment === 'center' ? 'flex justify-center' : textAlignment === 'right' ? 'flex justify-end' : ''}>
								<Button variant="default" asChild size="lg">
									<a href={ctaLink}>{ctaText}</a>
								</Button>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
