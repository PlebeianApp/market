import React from 'react'

export interface RichTextBlockProps {
	content: string
	alignment?: 'left' | 'center' | 'justify'
	typographyStyle?: 'serif' | 'sans' | 'mono'
	maxWidth?: string
	fontSize?: 'small' | 'medium' | 'large'
	backgroundColor?: string
	padding?: string
}

export const RichTextBlock: React.FC<RichTextBlockProps> = ({
	content,
	alignment = 'left',
	typographyStyle = 'sans',
	maxWidth = '32rem',
	fontSize = 'medium',
	backgroundColor = 'transparent',
	padding = 'py-12 px-6',
}) => {
	const alignmentClasses = {
		left: 'text-left',
		center: 'text-center',
		justify: 'text-justify',
	}

	const typographyClasses = {
		serif: 'font-serif',
		sans: 'font-sans',
		mono: 'font-mono',
	}

	const fontSizeClasses = {
		small: 'text-sm',
		medium: 'text-base',
		large: 'text-lg',
	}

	return (
		<div className={`${padding} ${backgroundColor !== 'transparent' ? `bg-${backgroundColor}` : ''}`}>
			<div
				className={`max-w-[${maxWidth}] mx-auto ${alignmentClasses[alignment]} ${typographyClasses[typographyStyle]} ${fontSizeClasses[fontSize]} text-gray-700 leading-relaxed`}
				dangerouslySetInnerHTML={{ __html: content }}
			/>
		</div>
	)
}
