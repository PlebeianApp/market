import type { Config } from '@puckeditor/core'
import { DataSourceField, STATIC_DATA_SOURCE_EMPTY } from '@/components/editor/DataSourceField'
import type { NDKUser } from '@nostr-dev-kit/ndk'

// Import the components we generated
import { CMSUserProfile } from '@/components/cms/CMSUserProfile'
import { HeroBanner, type HeroBannerProps } from '@/components/cms/CMSHeroBanner'
import { SplitFeature, type SplitFeatureProps } from '@/components/cms/CMSSplitFeature'
import { HeroCarousel, type HeroCarouselProps } from '@/components/cms/CMSHeroCarousel'
import { RichTextBlock, type RichTextBlockProps } from '@/components/cms/CMSRichTextBlock'
import { VideoEmbed, type VideoEmbedProps } from '@/components/cms/CMSVideoEmbed'
import { CheckboxField } from '@/components/editor/CheckboxField'
import { CMSProductGrid, type CMSProductGridProps } from '@/components/cms/CMSProductGrid'
import { CMSFeaturedProductCard, type CMSFeaturedProductCardProps } from '@/components/cms/CMSFeaturedProductCard'

// Define the component map for TypeScript inference
type Components = {
	HeroBanner: HeroBannerProps
	SplitFeature: SplitFeatureProps
	HeroCarousel: HeroCarouselProps
	CMSProductGrid: CMSProductGridProps
	CMSFeaturedProductCard: CMSFeaturedProductCardProps
	RichTextBlock: RichTextBlockProps
	VideoEmbed: VideoEmbedProps
	// Keep existing CMS components if needed
	CMSUserProfile: { identifier: string; relayUrl?: string }
	HeadingBlock: { title: string }
	Paragraph: { text: string }
}

export const getCMSConfig = (ownUser?: NDKUser): Config<Components> => ({
	components: {
		// --- Category 2: Hero & Landing ---

		HeroBanner: {
			fields: {
				backgroundImage: { type: 'text', label: 'Background Image URL' },
				backgroundVideo: { type: 'text', label: 'Background Video URL (optional)' },
				headline: { type: 'text', label: 'Headline' },
				subheadline: { type: 'text', label: 'Subheadline (optional)' },
				ctaButton: {
					type: 'object',
					label: 'Call to Action',
					objectFields: {
						text: { type: 'text', label: 'Button Text' },
						link: { type: 'text', label: 'Link URL' },
						variant: {
							type: 'select',
							label: 'Variant',
							options: [
								{ label: 'Primary', value: 'primary' },
								{ label: 'Secondary', value: 'secondary' },
								{ label: 'Outline', value: 'outline' },
							],
						},
					},
				},
				alignment: {
					type: 'select',
					label: 'Alignment',
					options: [
						{ label: 'Left', value: 'left' },
						{ label: 'Center', value: 'center' },
						{ label: 'Right', value: 'right' },
					],
				},
				overlayOpacity: { type: 'number', label: 'Overlay Opacity (0-1)' },
				minHeight: { type: 'text', label: 'Min Height (e.g., 100vh)' },
			},
			defaultProps: {
				headline: 'Welcome to the Future',
				subheadline: 'Discover unique art and technology.',
				alignment: 'center',
				ctaButton: { text: 'Explore Now', link: '#', variant: 'primary' },
				overlayOpacity: 0.4,
				minHeight: '100vh',
			},
			render: (props) => <HeroBanner {...props} />,
		},

		SplitFeature: {
			fields: {
				imageSrc: { type: 'text', label: 'Image URL' },
				imagePosition: {
					type: 'select',
					label: 'Image Position',
					options: [
						{ label: 'Left', value: 'left' },
						{ label: 'Right', value: 'right' },
					],
				},
				title: { type: 'text', label: 'Title' },
				description: { type: 'textarea', label: 'Description' },
				ctaLink: { type: 'text', label: 'CTA Link (optional)' },
				ctaText: { type: 'text', label: 'CTA Text' },
				verticalAlignment: {
					type: 'select',
					label: 'Vertical Alignment',
					options: [
						{ label: 'Top', value: 'top' },
						{ label: 'Middle', value: 'middle' },
						{ label: 'Bottom', value: 'bottom' },
					],
				},
			},
			defaultProps: {
				imageSrc: '',
				title: 'Our Mission',
				description: 'We build tools for the decentralized web.',
				imagePosition: 'left',
				verticalAlignment: 'middle',
				ctaText: 'Learn More',
			},
			render: (props) => <SplitFeature {...props} />,
		},

		HeroCarousel: {
			fields: {
				slides: {
					type: 'array',
					label: 'Slides',
					arrayFields: {
						image: { type: 'text', label: 'Image URL' },
						title: { type: 'text', label: 'Title' },
						subtitle: { type: 'text', label: 'Subtitle' },
						link: { type: 'text', label: 'Link' },
						ctaText: { type: 'text', label: 'Button Text' },
					},
					defaultItemProps: {
						image: '',
						title: '',
						subtitle: '',
						link: '',
						ctaText: 'View',
					},
				},
				autoplay: {
					type: 'custom',
					label: 'Autoplay',
					render: ({ field, value, name, onChange }) => <CheckboxField field={field} value={value} onChange={onChange} name={name} />,
				},
				rotationSpeed: { type: 'number', label: 'Rotation Speed (ms)' },
				showDots: {
					type: 'custom',
					label: 'Show Dots',
					render: ({ field, value, name, onChange }) => <CheckboxField field={field} value={value} onChange={onChange} name={name} />,
				},
				showArrows: {
					type: 'custom',
					label: 'Show Arrows',
					render: ({ field, value, name, onChange }) => <CheckboxField field={field} value={value} onChange={onChange} name={name} />,
				},
				transitionEffect: {
					type: 'select',
					label: 'Transition',
					options: [
						{ label: 'Fade', value: 'fade' },
						{ label: 'Slide', value: 'slide' },
					],
				},
			},
			defaultProps: {
				slides: [
					{ title: 'Slide 1', subtitle: 'First slide', image: 'https://via.placeholder.com/1200x600', ctaText: 'View', link: '#' },
					{ title: 'Slide 2', subtitle: 'Second slide', image: 'https://via.placeholder.com/1200x600', ctaText: 'View', link: '#' },
				],
				rotationSpeed: 5000,
				autoplay: true,
				showDots: true,
				showArrows: true,
			},
			render: (props) => <HeroCarousel {...props} />,
		},

		// --- Category 3: Product Display ---

		CMSProductGrid: {
			fields: {
				title: { type: 'text', label: 'Section Title' },
				dataSource: {
					type: 'custom',
					label: 'Data Source',
					render: ({ field, value, name, onChange }) => (
						<DataSourceField field={field} value={value ?? STATIC_DATA_SOURCE_EMPTY} onChange={onChange} />
					),
				},
				columnsDesktop: { type: 'number', label: 'Columns (Desktop)' },
				columnsTablet: { type: 'number', label: 'Columns (Tablet)' },
				columnsMobile: { type: 'number', label: 'Columns (Mobile)' },
				showVendor: {
					type: 'custom',
					label: 'Show Vendor',
					render: ({ field, value, name, onChange }) => <CheckboxField field={field} value={value} onChange={onChange} name={name} />,
				},
			},
			defaultProps: {
				title: 'Featured Products',
				dataSource: { type: 'static', ids: [] },
				columnsDesktop: 3,
				columnsTablet: 2,
				columnsMobile: 1,
				showVendor: true,
			},
			render: (props) => <CMSProductGrid {...props} />,
		},

		CMSFeaturedProductCard: {
			fields: {
				title: { type: 'text', label: 'Section Title' },
				dataSource: {
					type: 'custom',
					label: 'Data Source',
					render: ({ field, value, name, onChange }) => (
						<DataSourceField
							field={field}
							value={value ?? STATIC_DATA_SOURCE_EMPTY}
							onChange={onChange}
							allowedTypes={['static', 'dynamic']}
						/>
					),
				},
				showPrice: {
					type: 'custom',
					label: 'Show Price',
					render: ({ field, value, name, onChange }) => <CheckboxField field={field} value={value} onChange={onChange} name={name} />,
				},
				showDescriptionSnippet: {
					type: 'custom',
					label: 'Show Description',
					render: ({ field, value, name, onChange }) => <CheckboxField field={field} value={value} onChange={onChange} name={name} />,
				},
			},
			defaultProps: {
				title: 'Featured Product',
				dataSource: { type: 'static', ids: [] },
				showPrice: true,
				showDescriptionSnippet: true,
			},
			render: (props) => <CMSFeaturedProductCard {...props} />,
		},

		// --- Category 5: Content & Storytelling ---

		RichTextBlock: {
			fields: {
				content: { type: 'textarea', label: 'HTML Content' },
				alignment: {
					type: 'select',
					label: 'Alignment',
					options: [
						{ label: 'Left', value: 'left' },
						{ label: 'Center', value: 'center' },
						{ label: 'Justify', value: 'justify' },
					],
				},
				typographyStyle: {
					type: 'select',
					label: 'Font Family',
					options: [
						{ label: 'Serif', value: 'serif' },
						{ label: 'Sans', value: 'sans' },
						{ label: 'Mono', value: 'mono' },
					],
				},
				maxWidth: { type: 'text', label: 'Max Width (e.g., 32rem)' },
				fontSize: {
					type: 'select',
					label: 'Font Size',
					options: [
						{ label: 'Small', value: 'small' },
						{ label: 'Medium', value: 'medium' },
						{ label: 'Large', value: 'large' },
					],
				},
				backgroundColor: { type: 'text', label: 'Background Color (Tailwind class or hex)' },
				padding: { type: 'text', label: 'Padding (Tailwind class)' },
			},
			defaultProps: {
				content: '<p>This is a rich text block. You can paste HTML here.</p>',
				alignment: 'center',
				typographyStyle: 'sans',
				maxWidth: '32rem',
				padding: 'py-12 px-6',
			},
			render: (props) => <RichTextBlock {...props} />,
		},

		VideoEmbed: {
			fields: {
				videoUrl: { type: 'text', label: 'Video URL (YouTube or MP4)' },
				autoplay: {
					type: 'custom',
					label: 'Autoplay',
					render: ({ field, value, name, onChange }) => <CheckboxField field={field} value={value} onChange={onChange} name={name} />,
				},
				loop: {
					type: 'custom',
					label: 'Loop',
					render: ({ field, value, name, onChange }) => <CheckboxField field={field} value={value} onChange={onChange} name={name} />,
				},
				muted: {
					type: 'custom',
					label: 'Muted',
					render: ({ field, value, name, onChange }) => <CheckboxField field={field} value={value} onChange={onChange} name={name} />,
				},
				posterImage: { type: 'text', label: 'Poster Image URL (optional)' },
				aspectRatio: {
					type: 'select',
					label: 'Aspect Ratio',
					options: [
						{ label: '16:9', value: '16:9' },
						{ label: '4:3', value: '4:3' },
						{ label: '1:1', value: '1:1' },
					],
				},
				title: { type: 'text', label: 'Title' },
				showControls: {
					type: 'custom',
					label: 'Show Controls',
					render: ({ field, value, name, onChange }) => <CheckboxField field={field} value={value} onChange={onChange} name={name} />,
				},
			},
			defaultProps: {
				videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				aspectRatio: '16:9',
				title: 'Video',
				autoplay: false,
				loop: false,
				muted: false,
				showControls: true,
			},
			render: (props) => <VideoEmbed {...props} />,
		},

		// --- Existing CMS Components (Preserved) ---

		CMSUserProfile: {
			fields: {
				identifier: { type: 'text', label: 'Public Key (hex)' },
				relayUrl: { type: 'text', label: 'Relay URL (optional)' },
			},
			defaultProps: {
				identifier: ownUser?.npub ?? '',
			},
			render: ({ identifier }: { identifier: string }) => <CMSUserProfile identifier={identifier} />,
		},
		HeadingBlock: {
			fields: {
				title: { type: 'text' },
			},
			defaultProps: {
				title: 'Hello, world',
			},
			render: ({ title }: { title: string }) => {
				return <h1 className="text-3xl font-bold">{title}</h1>
			},
		},
		Paragraph: {
			fields: {
				text: { type: 'text' },
			},
			defaultProps: {
				text: 'Paragraph',
			},
			render: ({ text }: { text: string }) => (
				<div className="p-16">
					<p className="text-lg">{text}</p>
				</div>
			),
		},
	},
})
