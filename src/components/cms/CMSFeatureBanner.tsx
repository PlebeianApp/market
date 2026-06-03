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
	height = '400px',
	overlayOpacity = 0.4,
	className = '',
}) => {
	const getVariant = () => {
		switch (ctaVariant) {
			case 'secondary':
				return 'secondary'
			case 'outline':
				return 'outline'
			default:
				return 'default'
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
								<img src={imageSrc} alt={title} className="h-full max-h-full w-auto object-contain rounded-lg shadow-lg border" />
							</div>
						)}

						{/* Content Area */}
						<div className="flex-1 text-center lg:text-left min-w-0">
							<h2 className="text-3xl md:text-4xl font-heading tracking-wider text-white mb-4">{title}</h2>
							<p className="text-lg text-white/90 mb-8 max-w-2xl">{description}</p>

							{/* CTA using shadcn Button */}
							{ctaText && (
								<Button asChild variant={getVariant()}>
									<a href={ctaLink}>{ctaText}</a>
								</Button>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
