import type { StorefrontBlock, StorefrontThemeId } from '@/lib/schemas/storefront'

/**
 * The template registry: the first step of the setup wizard
 * (`StorefrontSetupWizard`).
 *
 * A template is a starting block list plus a suggested theme — nothing more.
 * It is not a separate format: every template is just a `StorefrontBlock[]`
 * drawn from the exact same closed union the Puck editor and the renderer
 * use, so a template can never produce a page the schema would reject. The
 * wizard's job is only to pick a reasonable *first draft*; everything it
 * produces stays fully editable afterward in the normal builder.
 *
 * Closed set, same reasoning as blocks and themes: a handful of good starting
 * points beat an open "create a template" feature neither this file nor the
 * CMS sidecar pattern (ADR-0006 §"Component Registry") was designed to host
 * safely from untrusted input.
 */

export type StorefrontTemplateId = 'blank' | 'link-in-bio' | 'shop' | 'showcase'

export interface StorefrontTemplate {
	id: StorefrontTemplateId
	label: string
	description: string
	/** Pre-selected in step 2 of the wizard; the author can still change it there. */
	defaultThemeId: StorefrontThemeId
	/**
	 * Placeholder block list. Every block here reuses the literal id `'tpl'` —
	 * harmless only because nothing ever renders or publishes this array
	 * directly. `instantiateStorefrontTemplate` is the sole consumer, and it
	 * replaces every id with a fresh one before the blocks reach a page.
	 */
	blocks: StorefrontBlock[]
}

export const STOREFRONT_TEMPLATES: StorefrontTemplate[] = [
	{
		id: 'blank',
		label: 'Blank page',
		description: 'Start from nothing and build your own layout block by block.',
		defaultThemeId: 'default',
		blocks: [],
	},
	{
		id: 'link-in-bio',
		label: 'Link in bio',
		description: 'Your profile up top, a list of links below. Good for a single landing page.',
		defaultThemeId: 'sunset',
		blocks: [
			{ type: 'ProfileHeader', props: { id: 'tpl', showBanner: true, showAbout: true, showNip05: true, align: 'center' } },
			{
				type: 'LinkList',
				props: {
					id: 'tpl',
					title: 'Find me elsewhere',
					layout: 'column',
					links: [],
				},
			},
		],
	},
	{
		id: 'shop',
		label: 'Shop',
		description: 'Lead with a banner, then show everything you sell in a grid.',
		defaultThemeId: 'default',
		blocks: [
			{ type: 'ProfileHeader', props: { id: 'tpl', showBanner: true, showAbout: true, showNip05: true, align: 'center' } },
			{
				type: 'Hero',
				props: {
					id: 'tpl',
					title: 'Welcome to my shop',
					subtitle: '',
					imageUrl: '',
					ctaLabel: '',
					ctaHref: '',
					align: 'center',
					minHeight: 320,
				},
			},
			{
				type: 'ProductGrid',
				props: {
					id: 'tpl',
					title: 'All products',
					source: 'all',
					collectionDTag: '',
					limit: 12,
					columns: 3,
					emptyMessage: 'Nothing listed here yet.',
				},
			},
		],
	},
	{
		id: 'showcase',
		label: 'Showcase',
		description: 'Feature one standout item, then a gallery of everything else below it.',
		defaultThemeId: 'midnight',
		blocks: [
			{ type: 'ProfileHeader', props: { id: 'tpl', showBanner: true, showAbout: false, showNip05: true, align: 'center' } },
			{ type: 'FeaturedProduct', props: { id: 'tpl', productDTag: '' } },
			{
				type: 'ProductGrid',
				props: {
					id: 'tpl',
					title: 'More from this shop',
					source: 'all',
					collectionDTag: '',
					limit: 9,
					columns: 3,
					emptyMessage: 'Nothing listed here yet.',
				},
			},
		],
	},
]

/** Falls back to the first template (`blank`) for an id outside the closed set. */
export function getStorefrontTemplate(id: string | undefined): StorefrontTemplate {
	return STOREFRONT_TEMPLATES.find((template) => template.id === id) ?? STOREFRONT_TEMPLATES[0]
}

/**
 * Turns a template's placeholder blocks into real ones with fresh, unique
 * ids. Called once when the author finishes the wizard, and again every time
 * the wizard re-renders a live preview — each call is independent, so reusing
 * a template (or reopening the wizard) never collides with a previous
 * instance's block ids.
 */
export function instantiateStorefrontTemplate(template: StorefrontTemplate): StorefrontBlock[] {
	return template.blocks.map((block) => withFreshBlockId(block))
}

/**
 * Generic over the specific union member (`B extends StorefrontBlock`) rather
 * than typed as `(block: StorefrontBlock) => StorefrontBlock`: the latter
 * would make TypeScript merge every variant's `props` into one shape during
 * the spread, losing the discriminated union's per-type correlation it needs
 * to accept the result as `StorefrontBlock[]` without a cast.
 */
function withFreshBlockId<B extends StorefrontBlock>(block: B): B {
	return { ...block, props: { ...block.props, id: `${block.type}-${crypto.randomUUID()}` } }
}
