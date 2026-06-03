// src/config/cms.tsx
import type { Config } from '@puckeditor/core'
import { DataSourceField, STATIC_DATA_SOURCE_EMPTY } from '@/components/editor/DataSourceField'
import type { NDKUser } from '@nostr-dev-kit/ndk'

// Import the components we generated
import { CheckboxField } from '@/components/editor/CheckboxField'
import { CMSProductGrid, type CMSProductGridProps } from '@/components/cms/CMSProductGrid'
import { CMSDivider, type CMSDividerProps } from '@/components/cms/CMSDivider'
import { CMSProductRow, type CMSProductRowProps } from '@/components/cms/CMSProductRow'
import { CMSFeatureBanner, type CMSFeatureBannerProps } from '@/components/cms/CMSFeatureBanner'
import { CMSProductFeature, type CMSProductFeatureProps } from '@/components/cms'
import { CMSSimpleHero, type CMSSimpleHeroProps } from '@/components/cms/CMSSimpleHero'

// Define the component map for TypeScript inference
type Components = {
	CMSProductGrid: CMSProductGridProps
	CMSDivider: CMSDividerProps
	CMSProductRow: CMSProductRowProps
	CMSFeatureBanner: CMSFeatureBannerProps
	CMSProductFeature: CMSProductFeatureProps
	CMSSimpleHero: CMSSimpleHeroProps
}

export const getCMSConfig = (ownUser?: NDKUser): Config<Components> => ({
	components: {
		CMSSimpleHero: {
			fields: {
				backgroundImage: { type: 'text', label: 'Background Image URL' },
				title: { type: 'text', label: 'Title' },
				subtitle: { type: 'textarea', label: 'Subtitle (optional)' },
				ctaText: { type: 'text', label: 'CTA Button Text' },
				ctaLink: { type: 'text', label: 'CTA Link URL' },
				textAlignment: {
					type: 'select',
					label: 'Text Alignment',
					options: [
						{ label: 'Left', value: 'left' },
						{ label: 'Center', value: 'center' },
						{ label: 'Right', value: 'right' },
					],
				},
				height: { type: 'text', label: 'Banner Height (e.g., 400px, 50vh)' },
				overlayOpacity: {
					type: 'number',
					label: 'Overlay Opacity (0-1)',
					min: 0,
					max: 1,
					step: 0.1,
				},
			},
			defaultProps: {
				title: 'Welcome to Our Store',
				subtitle: 'Discover amazing products from talented creators',
				textAlignment: 'center',
				ctaText: 'Shop Now',
				ctaLink: '#',
				height: '500px',
				overlayOpacity: 0.4,
			},
			render: (props) => <CMSSimpleHero {...props} />,
		},

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

		CMSProductRow: {
			fields: {
				title: { type: 'text', label: 'Section Title' },
				dataSource: {
					type: 'custom',
					label: 'Data Source',
					render: ({ field, value, name, onChange }) => (
						<DataSourceField field={field} value={value ?? STATIC_DATA_SOURCE_EMPTY} onChange={onChange} />
					),
				},
				showVendor: {
					type: 'custom',
					label: 'Show Vendor',
					render: ({ field, value, name, onChange }) => <CheckboxField field={field} value={value} onChange={onChange} name={name} />,
				},
			},
			defaultProps: {
				title: 'Featured Products',
				dataSource: { type: 'static', ids: [] },
				showVendor: true,
			},
			render: (props) => <CMSProductRow {...props} />,
		},

		CMSFeatureBanner: {
			fields: {
				backgroundImage: { type: 'text', label: 'Background Image URL' },
				imageSrc: { type: 'text', label: 'Left Image URL (optional)' },
				title: { type: 'text', label: 'Title' },
				description: { type: 'textarea', label: 'Description' },
				ctaText: { type: 'text', label: 'CTA Button Text' },
				ctaLink: { type: 'text', label: 'CTA Link URL' },
				ctaVariant: {
					type: 'select',
					label: 'CTA Button Variant',
					options: [
						{ label: 'Primary', value: 'primary' },
						{ label: 'Secondary', value: 'secondary' },
						{ label: 'Outline', value: 'outline' },
					],
				},
				height: { type: 'text', label: 'Banner Height (e.g., 400px, 50vh)' },
				overlayOpacity: {
					type: 'number',
					label: 'Overlay Opacity (0-1)',
					min: 0,
					max: 1,
					step: 0.1,
				},
			},
			defaultProps: {
				title: 'Feature Title',
				description: 'Feature description text goes here.',
				ctaText: 'Learn More',
				ctaLink: '#',
				ctaVariant: 'default',
				height: '400px',
				overlayOpacity: 0.4,
			},
			render: (props) => <CMSFeatureBanner {...props} />,
		},

		CMSDivider: {
			fields: {},
			defaultProps: {},
			render: (props) => <CMSDivider {...props} />,
		},

		// Add to the components configuration in src/config/cms.tsx
		CMSProductFeature: {
			fields: {
				dataSource: {
					type: 'custom',
					label: 'Data Source',
					render: ({ field, value, name, onChange }) => (
						<DataSourceField field={field} value={value ?? STATIC_DATA_SOURCE_EMPTY} onChange={onChange} allowedTypes={['static']} />
					),
				},
				backgroundImage: { type: 'text', label: 'Background Image URL' },
				backgroundColor: { type: 'text', label: 'Background Color (Tailwind class or hex)' },
				overlayOpacity: {
					type: 'number',
					label: 'Overlay Opacity (0-1)',
					min: 0,
					max: 1,
					step: 0.1,
				},
				height: { type: 'text', label: 'Banner Height (e.g., 400px, 50vh)' },
			},
			defaultProps: {
				dataSource: { type: 'static', ids: [] },
				overlayOpacity: 0.4,
				height: '400px',
			},
			render: (props) => <CMSProductFeature {...props} />,
		},
	},
})
