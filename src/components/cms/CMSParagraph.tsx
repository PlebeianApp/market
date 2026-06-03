// src/components/cms/CMSParagraph.tsx
import React from 'react'
import { Button } from '@/components/ui/button'

export interface CMSParagraphProps {
	title?: string
	content: string
	imageSrc?: string
	ctaText?: string
	ctaLink?: string
	textAlignment?: 'left' | 'center' | 'right'
	className?: string
}

export const CMSParagraph: React.FC<CMSParagraphProps> = ({
	title = '',
	content = '',
	imageSrc = '',
	ctaText = '',
	ctaLink = '#',
	textAlignment = 'left',
	className = '',
}) => {
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

	return (
		<div className={`py-12 px-6 max-w-7xl mx-auto ${className}`}>
			<div className="flex flex-col lg:flex-row gap-8 items-start">
				{/* Text Content */}
				<div className={`flex-1 ${imageSrc ? '' : 'w-full'}`}>
					<div className={`flex flex-col ${getTextAlignmentClass()}`}>
						{/* Title */}
						{title && <h2 className="text-2xl md:text-3xl font-heading tracking-wider text-foreground mb-6">{title}</h2>}

						{/* Content */}
						{content && (
							<div
								className="text-muted-foreground mb-6 prose prose-stone dark:prose-invert max-w-none"
								dangerouslySetInnerHTML={{ __html: content }}
							/>
						)}

						{/* CTA Button */}
						{ctaText && (
							<div className={textAlignment === 'center' ? 'flex justify-center' : textAlignment === 'right' ? 'flex justify-end' : ''}>
								<Button asChild>
									<a href={ctaLink}>{ctaText}</a>
								</Button>
							</div>
						)}
					</div>
				</div>

				{/* Image (Optional) */}
				{imageSrc && (
					<div className="w-full lg:w-1/3">
						<img src={imageSrc} alt={title || 'Paragraph image'} className="w-full h-auto rounded-lg shadow-md object-cover" />
					</div>
				)}
			</div>
		</div>
	)
}
