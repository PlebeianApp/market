import { CollectionPickerField, ProductPickerField } from '@/components/storefront/builder/fields/ItemPickerField'
import { ThemePaletteStrip, ThemeSwatchGrid, ThemeTunePanel } from '@/components/storefront/builder/fields/ThemePickerField'
import { StorefrontBlockView, StorefrontRoot } from '@/components/storefront/StorefrontRenderer'
import { STOREFRONT_THEMES } from '@/config/storefrontThemes'
import type {
	StorefrontBlock,
	StorefrontBlockType,
	StorefrontRootProps,
	StorefrontThemeId,
	StorefrontThemeTune,
} from '@/lib/schemas/storefront'
import { STOREFRONT_TUNE_DEFAULTS, StorefrontRootPropsSchema } from '@/lib/schemas/storefront'
import { usePuck, type Config } from '@puckeditor/core'

/**
 * The CMS component registry: what the Puck editor can put on a page.
 *
 * Two invariants tie this file to `src/lib/schemas/storefront.ts`:
 *
 *  1. Every key in `components` is a block `type` in the schema's discriminated
 *     union, and `STOREFRONT_COMPONENT_KEYS` below is type-checked against it.
 *     A component the editor can add but the schema rejects would let an author
 *     build a page that silently loses blocks the moment they publish.
 *
 *  2. Each `render` delegates to `StorefrontBlockView` — the same switch the
 *     published page uses. The canvas is therefore not a preview of the page;
 *     it is the page, with editor chrome around it. Preview drift is not
 *     something we keep in sync, it is something that cannot happen.
 *
 * Field definitions here shape the sidebar only. They are a convenience, never
 * a security boundary: the schema validates on publish and again on read, since
 * a document can reach the renderer without ever passing through this editor.
 */

/** Renders one block through the production renderer, with editor context on. */
function renderBlock<T extends StorefrontBlockType>(type: T) {
	return (props: Record<string, unknown>) => {
		// Puck injects `puck` and `editMode` alongside the author's props; the
		// block union does not know about them.
		const { puck: _puck, editMode: _editMode, ...blockProps } = props as Record<string, unknown> & { puck?: unknown; editMode?: unknown }
		return <StorefrontBlockView block={{ type, props: blockProps } as StorefrontBlock} />
	}
}

const alignOptions = [
	{ label: 'Left', value: 'left' },
	{ label: 'Centre', value: 'center' },
	{ label: 'Right', value: 'right' },
]

const widthOptions = [
	{ label: 'Narrow', value: 'narrow' },
	{ label: 'Normal', value: 'normal' },
	{ label: 'Wide', value: 'wide' },
]

/**
 * The layout currently selected on the page, read from Puck's own state.
 *
 * Steps 2 and 3 need to know which layout is chosen, and a Puck custom field
 * receives only its own `value` and `onChange` — there is no sibling access.
 * `usePuck` is the supported way to read it, and these fields only ever render
 * inside the editor sidebar, which is inside the Puck context.
 */
function useRootTheme(): StorefrontThemeId {
	const { appState } = usePuck()
	const theme = (appState?.data?.root?.props as { theme?: string } | undefined)?.theme
	return (theme && Object.prototype.hasOwnProperty.call(STOREFRONT_THEMES, theme) ? theme : 'default') as StorefrontThemeId
}

/** Step 2 as a sidebar field: the colourways of whichever layout is selected. */
function ThemePaletteField({ value, onChange, readOnly }: { value?: string; onChange: (v: string) => void; readOnly?: boolean }) {
	const theme = useRootTheme()
	return <ThemePaletteStrip themeId={theme} value={value ?? ''} onChange={onChange} readOnly={readOnly} />
}

/** Step 3 as a sidebar field: the six bounded axes for the selected layout. */
function ThemeTuneField({
	value,
	onChange,
	readOnly,
}: {
	value?: Partial<StorefrontThemeTune>
	onChange: (v: StorefrontThemeTune) => void
	readOnly?: boolean
}) {
	const theme = useRootTheme()
	return <ThemeTunePanel themeId={theme} value={value} onChange={onChange} readOnly={readOnly} />
}

export const storefrontCmsConfig: Config = {
	categories: {
		identity: { title: 'Identity', components: ['ProfileHeader', 'Hero'] },
		content: { title: 'Content', components: ['Text', 'Image', 'LinkList'] },
		commerce: { title: 'Products', components: ['ProductGrid', 'FeaturedProduct'] },
		layout: { title: 'Layout', components: ['Divider', 'Spacer'] },
	},

	root: {
		fields: {
			title: { type: 'text', label: 'Page title' },
			theme: {
				type: 'custom',
				label: 'Layout',
				render: ({ value, onChange, readOnly }) => (
					<ThemeSwatchGrid value={(value as StorefrontThemeId) ?? 'default'} onChange={onChange} readOnly={readOnly} />
				),
			},
			// Steps 2 and 3 of the studio flow, as separate root fields: Puck binds
			// one field to one value, so the palette and the tune each need their
			// own — and each reads the selected layout from Puck's state.
			palette: {
				type: 'custom',
				label: 'Colours',
				render: ({ value, onChange, readOnly }) => <ThemePaletteField value={value as string} onChange={onChange} readOnly={readOnly} />,
			},
			tune: {
				type: 'custom',
				label: 'Fine-tune',
				render: ({ value, onChange, readOnly }) => (
					<ThemeTuneField value={value as Partial<StorefrontThemeTune>} onChange={onChange} readOnly={readOnly} />
				),
			},
		},
		defaultProps: { title: '', theme: 'default', palette: '', tune: STOREFRONT_TUNE_DEFAULTS },
		// The canvas wraps children in the very element the published page uses,
		// so a background chosen here looks the same in both places.
		render: ({ children, ...rootProps }: { children?: React.ReactNode } & Partial<StorefrontRootProps>) => {
			// safeParse, not parse: a throw here would take the whole editor down
			// over a root prop the author can still fix.
			const parsed = StorefrontRootPropsSchema.safeParse(rootProps)
			return <StorefrontRoot props={parsed.success ? parsed.data : StorefrontRootPropsSchema.parse({})}>{children}</StorefrontRoot>
		},
	},

	components: {
		ProfileHeader: {
			label: 'Profile header',
			fields: {
				showBanner: {
					type: 'radio',
					label: 'Banner',
					options: [
						{ label: 'Show', value: true },
						{ label: 'Hide', value: false },
					],
				},
				fullScreen: {
					type: 'radio',
					label: 'Full-screen height',
					options: [
						{ label: 'On', value: true },
						{ label: 'Off', value: false },
					],
				},
				showAbout: {
					type: 'radio',
					label: 'About text',
					options: [
						{ label: 'Show', value: true },
						{ label: 'Hide', value: false },
					],
				},
				showNip05: {
					type: 'radio',
					label: 'Nostr address',
					options: [
						{ label: 'Show', value: true },
						{ label: 'Hide', value: false },
					],
				},
				align: { type: 'select', label: 'Alignment', options: alignOptions },
			},
			defaultProps: { showBanner: true, fullScreen: false, showAbout: true, showNip05: true, align: 'center' },
			render: renderBlock('ProfileHeader'),
		},

		Hero: {
			label: 'Hero banner',
			fields: {
				title: { type: 'text', label: 'Title' },
				subtitle: { type: 'textarea', label: 'Subtitle' },
				imageUrl: { type: 'text', label: 'Background image URL', placeholder: 'https://…' },
				ctaLabel: { type: 'text', label: 'Button label' },
				ctaHref: { type: 'text', label: 'Button link', placeholder: 'https://… or /products' },
				align: { type: 'select', label: 'Alignment', options: alignOptions },
				minHeight: { type: 'number', label: 'Height (px)', min: 120, max: 1200, step: 20 },
			},
			defaultProps: {
				title: 'Welcome',
				subtitle: '',
				imageUrl: '',
				ctaLabel: '',
				ctaHref: '',
				align: 'center',
				minHeight: 360,
			},
			render: renderBlock('Hero'),
		},

		Text: {
			label: 'Text',
			fields: {
				markdown: {
					type: 'textarea',
					label: 'Text (markdown)',
					placeholder: '# Heading\n\nSome **bold** text with a [link](https://example.com).',
				},
				align: { type: 'select', label: 'Alignment', options: alignOptions },
				width: { type: 'select', label: 'Width', options: widthOptions },
			},
			defaultProps: { markdown: '', align: 'left', width: 'normal' },
			render: renderBlock('Text'),
		},

		ProductGrid: {
			label: 'Product grid',
			fields: {
				title: { type: 'text', label: 'Section title' },
				source: {
					type: 'radio',
					label: 'Show',
					options: [
						{ label: 'All my products', value: 'all' },
						{ label: 'One collection', value: 'collection' },
					],
				},
				collectionDTag: {
					type: 'custom',
					label: 'Collection',
					render: ({ value, onChange, readOnly }) => (
						<CollectionPickerField label="Collection" value={(value as string) ?? ''} onChange={onChange} readOnly={readOnly} />
					),
				},
				limit: { type: 'number', label: 'Maximum products', min: 1, max: 60, step: 1 },
				columns: {
					type: 'select',
					label: 'Columns',
					options: [
						{ label: 'Two', value: 2 },
						{ label: 'Three', value: 3 },
						{ label: 'Four', value: 4 },
					],
				},
				emptyMessage: { type: 'text', label: 'Message when empty' },
			},
			defaultProps: {
				title: 'Products',
				source: 'all',
				collectionDTag: '',
				limit: 12,
				columns: 3,
				emptyMessage: 'Nothing listed here yet.',
			},
			render: renderBlock('ProductGrid'),
		},

		FeaturedProduct: {
			label: 'Featured product',
			fields: {
				productDTag: {
					type: 'custom',
					label: 'Product',
					render: ({ value, onChange, readOnly }) => (
						<ProductPickerField label="Product" value={(value as string) ?? ''} onChange={onChange} readOnly={readOnly} />
					),
				},
			},
			defaultProps: { productDTag: '' },
			render: renderBlock('FeaturedProduct'),
		},

		LinkList: {
			label: 'Links',
			fields: {
				title: { type: 'text', label: 'Section title' },
				links: {
					type: 'array',
					label: 'Links',
					max: 25,
					getItemSummary: (item: { label?: string }) => item?.label || 'Link',
					arrayFields: {
						label: { type: 'text', label: 'Label' },
						href: { type: 'text', label: 'Address', placeholder: 'https://…' },
					},
					defaultItemProps: { label: 'New link', href: 'https://' },
				},
				layout: {
					type: 'radio',
					label: 'Layout',
					options: [
						{ label: 'Row', value: 'row' },
						{ label: 'Column', value: 'column' },
					],
				},
			},
			defaultProps: { title: 'Find me elsewhere', links: [], layout: 'row' },
			render: renderBlock('LinkList'),
		},

		Image: {
			label: 'Image',
			fields: {
				url: { type: 'text', label: 'Image URL', placeholder: 'https://…' },
				alt: { type: 'text', label: 'Alt text (for screen readers)' },
				width: {
					type: 'select',
					label: 'Width',
					options: [...widthOptions, { label: 'Full bleed', value: 'full' }],
				},
				rounded: {
					type: 'radio',
					label: 'Corners',
					options: [
						{ label: 'Rounded', value: true },
						{ label: 'Square', value: false },
					],
				},
				href: { type: 'text', label: 'Link to (optional)', placeholder: 'https://… or /products' },
			},
			defaultProps: { url: '', alt: '', width: 'normal', rounded: true, href: '' },
			render: renderBlock('Image'),
		},

		Divider: {
			label: 'Divider',
			fields: {},
			defaultProps: {},
			render: renderBlock('Divider'),
		},

		Spacer: {
			label: 'Spacer',
			fields: {
				size: {
					type: 'select',
					label: 'Size',
					options: [
						{ label: 'Small', value: 'sm' },
						{ label: 'Medium', value: 'md' },
						{ label: 'Large', value: 'lg' },
						{ label: 'Extra large', value: 'xl' },
					],
				},
			},
			defaultProps: { size: 'md' },
			render: renderBlock('Spacer'),
		},
	},
}

/**
 * Compile-time assertion that the editor offers exactly the block types the
 * schema accepts. If the two drift, this stops being assignable.
 */
export const STOREFRONT_COMPONENT_KEYS = Object.keys(storefrontCmsConfig.components) as StorefrontBlockType[]
