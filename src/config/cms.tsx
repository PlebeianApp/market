import type { Config } from '@puckeditor/core'
import { DataSourceField, STATIC_DATA_SOURCE_EMPTY } from '@/components/editor/DataSourceField'
import type { NDKUser } from '@nostr-dev-kit/ndk'
import { useEffect, useRef } from 'react'
import { applyLocalTheme } from '@/lib/utils/theme'

// Import the components we generated
import { CheckboxField } from '@/components/editor/CheckboxField'
import { CMSProductGrid, type CMSProductGridProps } from '@/components/cms/CMSProductGrid'
import { CMSDivider, type CMSDividerProps } from '@/components/cms/CMSDivider'
import { CMSProductRow, type CMSProductRowProps } from '@/components/cms/CMSProductRow'
import { CMSFeatureBanner, type CMSFeatureBannerProps } from '@/components/cms/CMSFeatureBanner'
import { CMSProductFeature, CMSUserProfile, type CMSProductFeatureProps, type CMSUserProfileProps } from '@/components/cms'
import { CMSSimpleHero, type CMSSimpleHeroProps } from '@/components/cms/CMSSimpleHero'
import { CMSThemeSelector } from '@/components/cms/CMSThemeSelector'

// Define the component map for TypeScript inference
export type CMSComponents = {
	CMSProductGrid: CMSProductGridProps
	CMSDivider: CMSDividerProps
	CMSProductRow: CMSProductRowProps
	CMSFeatureBanner: CMSFeatureBannerProps
	CMSProductFeature: CMSProductFeatureProps
	CMSSimpleHero: CMSSimpleHeroProps
	CMSUserProfile: CMSUserProfileProps
}

export type CMSRootProps = {
	title?: string | undefined
	theme?: string
}

export const getCMSConfig = (ownUser?: NDKUser): Config<CMSComponents, CMSRootProps> => ({
	root: {
		fields: {
			theme: {
				type: 'custom',
				label: 'Page Theme',
				render: ({ field, value, name, onChange }) => (
					<div className="py-2">
						<CMSThemeSelector initialTheme={value || 'default'} onThemeChange={(themeId) => onChange(themeId)} />
					</div>
				),
			},
		},
		defaultProps: {
			theme: 'default',
		},
		render: ({ children, ...props }) => {
			// Create a ref for the root element to apply themes
			const rootRef = useRef<HTMLDivElement>(null)

			// Apply theme when props change
			useEffect(() => {
				if (rootRef.current && props.theme) {
					applyLocalTheme(rootRef.current, props.theme)
				} else if (rootRef.current) {
					// Clear theme if none is set
					rootRef.current.style.cssText = ''
				}
			}, [props.theme])

			return (
				<div ref={rootRef} className="min-h-screen bg-background">
					{children}
				</div>
			)
		},
	},
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
			label: 'Hero Banner',
		},

		CMSFeatureBanner: {
			fields: {
				backgroundImage: { type: 'text', label: 'Background Image URL' },
				imageSrc: { type: 'text', label: 'Feature Image URL (optional)' },
				title: { type: 'text', label: 'Title' },
				description: { type: 'textarea', label: 'Description' },
				ctaText: { type: 'text', label: 'CTA Button Text' },
				ctaLink: { type: 'text', label: 'CTA Link URL' },
				ctaVariant: {
					type: 'select',
					label: 'CTA Button Variant',
					options: [
						{ label: 'Primary', value: 'default' },
						{ label: 'Secondary', value: 'secondary' },
						{ label: 'Outline', value: 'outline' },
					],
				},
				imagePosition: {
					type: 'select',
					label: 'Image Position',
					options: [
						{ label: 'Left', value: 'left' },
						{ label: 'Right', value: 'right' },
					],
				},
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
				title: 'Feature Title',
				description: 'Feature description text goes here.',
				ctaText: 'Learn More',
				ctaLink: '#',
				ctaVariant: 'default',
				imagePosition: 'left',
				textAlignment: 'left',
				height: '400px',
				overlayOpacity: 0.4,
			},
			render: (props) => <CMSFeatureBanner {...props} />,
			label: 'Feature Highlight',
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
			label: 'Product Row',
		},

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
			label: 'Single Product Spotlight',
		},

		CMSUserProfile: {
			fields: {
				identifier: { type: 'text', label: 'User Identifier (pubkey, npub, nip-05)' },
				relayUrl: { type: 'text', label: 'Relay URL (optional)' },
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
				ctaText: { type: 'text', label: 'CTA Button Text' },
				ctaLink: { type: 'text', label: 'CTA Link URL' },
			},
			defaultProps: {
				identifier: ownUser?.npub ?? '',
				overlayOpacity: 0.4,
				height: '400px',
				ctaText: '',
				ctaLink: '#',
			},
			render: (props) => <CMSUserProfile {...props} />,
			label: 'Creator Profile',
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
			label: 'Product Grid',
		},

		CMSDivider: {
			fields: {},
			defaultProps: {},
			render: (props) => <CMSDivider {...props} />,
			label: 'Section Divider',
		},
	},
})
