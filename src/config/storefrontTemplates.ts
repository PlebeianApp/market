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

export type StorefrontTemplateId = 'blank' | 'link-in-bio' | 'shop' | 'showcase' | 'farmer' | 'artist' | 'electrician' | 'store'

export interface StorefrontTemplate {
	id: StorefrontTemplateId
	label: string
	description: string
	/** Pre-selected in step 2 of the wizard; the author can still change it there. */
	defaultThemeId: StorefrontThemeId
	typography?: 'editorial'
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
			{
				type: 'ProfileHeader',
				props: { id: 'tpl', showBanner: true, fullScreen: false, showAbout: true, showNip05: true, align: 'center' },
			},
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
		id: 'farmer',
		label: 'Farmstand',
		description: 'For farmers: a seasonal harvest, your farm story, and practical pickup information.',
		defaultThemeId: 'forest',
		typography: 'editorial',
		blocks: [
			{
				type: 'ProfileHeader',
				props: {
					id: 'tpl',
					showBanner: false,
					fullScreen: false,
					showAbout: false,
					showNip05: true,
					align: 'left',
					layout: 'compact',
					navigation: [
						{ label: 'Shop the harvest', href: '#harvest' },
						{ label: 'Our farm', href: '#our-farm' },
						{ label: 'Pickup & delivery', href: '#visit' },
					],
				},
			},
			{
				type: 'Hero',
				props: {
					id: 'tpl',
					title: 'Fresh from the farm',
					subtitle: 'Good food starts with knowing where it grows. Explore the harvest and bring a little of the farm to your table.',
					imageUrl: '/images/farmstand.svg',
					ctaLabel: 'Shop the harvest',
					ctaHref: '#harvest',
					align: 'left',
					minHeight: 520,
					layout: 'split',
					eyebrow: 'The farmstand',
				},
			},
			{
				type: 'ProductGrid',
				props: {
					id: 'tpl',
					title: 'This season at the farm',
					source: 'all',
					collectionDTag: '',
					limit: 6,
					columns: 3,
					emptyMessage: 'The next harvest will be listed here.',
					anchor: 'harvest',
					cardStyle: 'storefront',
				},
			},
			{
				type: 'Text',
				props: {
					id: 'tpl',
					markdown: '## Rooted in our community\n\nTell the story of your farm, what you grow, and how you care for the land.',
					align: 'left',
					width: 'narrow',
					anchor: 'our-farm',
				},
			},
			{ type: 'Divider', props: { id: 'tpl' } },
			{
				type: 'Text',
				props: {
					id: 'tpl',
					markdown:
						'## From our farm to your table\n\n### Farm pickup\nAdd your pickup location, days, and ordering deadline.\n\n### Markets and delivery\nList the markets you attend and any delivery areas or fees.',
					align: 'left',
					width: 'normal',
					anchor: 'visit',
				},
			},
			{ type: 'LinkList', props: { id: 'tpl', title: 'Plan your visit', layout: 'row', links: [] } },
		],
	},
	{
		id: 'artist',
		label: 'Studio',
		description: 'For artists: a quiet, two-column gallery with room for your process and commissions.',
		defaultThemeId: 'mono',
		blocks: [
			{
				type: 'Hero',
				props: {
					id: 'tpl',
					title: 'Made to mean something.',
					subtitle: 'Original work. Small editions. A little of the unexpected.',
					imageUrl: '',
					ctaLabel: '',
					ctaHref: '',
					align: 'center',
					minHeight: 280,
				},
			},
			{
				type: 'ProductGrid',
				props: {
					id: 'tpl',
					title: 'Available works',
					source: 'all',
					collectionDTag: '',
					limit: 8,
					columns: 2,
					emptyMessage: 'New work will appear here when it is available.',
				},
			},
			{ type: 'Divider', props: { id: 'tpl' } },
			{
				type: 'Text',
				props: {
					id: 'tpl',
					markdown: '## Inside the studio\n\nIntroduce your practice, materials, and the ideas behind your work.',
					align: 'left',
					width: 'narrow',
				},
			},
			{
				type: 'Text',
				props: {
					id: 'tpl',
					markdown: '## Something just for you\n\nExplain whether you accept commissions, how to enquire, and your current lead times.',
					align: 'left',
					width: 'narrow',
				},
			},
			{ type: 'LinkList', props: { id: 'tpl', title: 'Commissions and studio enquiries', layout: 'row', links: [] } },
			{
				type: 'ProfileHeader',
				props: { id: 'tpl', showBanner: false, fullScreen: false, showAbout: true, showNip05: true, align: 'center' },
			},
		],
	},
	{
		id: 'electrician',
		label: 'Local Pro',
		description: 'For electricians: services first, then service areas, qualifications, and a clear enquiry path.',
		defaultThemeId: 'default',
		blocks: [
			{
				type: 'Hero',
				props: {
					id: 'tpl',
					title: 'Electrical work, done right.',
					subtitle: 'Tell us what your home or business needs.',
					imageUrl: '',
					ctaLabel: '',
					ctaHref: '',
					align: 'left',
					minHeight: 240,
				},
			},
			{ type: 'LinkList', props: { id: 'tpl', title: 'Discuss your project', layout: 'row', links: [] } },
			{
				type: 'ProductGrid',
				props: {
					id: 'tpl',
					title: 'Services',
					source: 'all',
					collectionDTag: '',
					limit: 6,
					columns: 3,
					emptyMessage: 'Service listings will appear here.',
				},
			},
			{
				type: 'Text',
				props: {
					id: 'tpl',
					markdown:
						'## Local knowledge. Clear communication.\n\n### Where I work\nAdd your service area and working hours.\n\n### Experience and qualifications\nAdd your actual qualifications, registration details, and relevant experience.',
					align: 'left',
					width: 'normal',
				},
			},
			{ type: 'Divider', props: { id: 'tpl' } },
			{
				type: 'Text',
				props: {
					id: 'tpl',
					markdown:
						'## How to book\n\n- Describe the work and where it is needed.\n- Include useful photos and your preferred dates.\n- Explain your quote and booking process here, including any call-out fees.',
					align: 'left',
					width: 'normal',
				},
			},
			{
				type: 'ProfileHeader',
				props: { id: 'tpl', showBanner: false, fullScreen: false, showAbout: false, showNip05: true, align: 'left' },
			},
		],
	},
	{
		id: 'store',
		label: 'Corner Shop',
		description: 'For retailers: a short welcome, a generous catalogue, and straightforward shopping information.',
		defaultThemeId: 'sunset',
		blocks: [
			{
				type: 'Hero',
				props: {
					id: 'tpl',
					title: 'Find your next favourite.',
					subtitle: 'A collection worth exploring.',
					imageUrl: '',
					ctaLabel: '',
					ctaHref: '',
					align: 'left',
					minHeight: 200,
				},
			},
			{
				type: 'ProductGrid',
				props: {
					id: 'tpl',
					title: 'Browse the collection',
					source: 'all',
					collectionDTag: '',
					limit: 12,
					columns: 4,
					emptyMessage: 'Our shelves are being stocked. Check back soon.',
				},
			},
			{
				type: 'Text',
				props: {
					id: 'tpl',
					markdown: '## A little about our shop\n\nShare what you sell, how you choose it, and what makes your shop yours.',
					align: 'center',
					width: 'narrow',
				},
			},
			{ type: 'Divider', props: { id: 'tpl' } },
			{
				type: 'Text',
				props: {
					id: 'tpl',
					markdown:
						'## Good to know\n\n### Shipping and collection\nAdd your dispatch times, delivery areas, and local collection options.\n\n### Returns and questions\nExplain your returns policy and how customers can get in touch.',
					align: 'left',
					width: 'normal',
				},
			},
			{ type: 'LinkList', props: { id: 'tpl', title: 'Visit or contact the shop', layout: 'row', links: [] } },
			{
				type: 'ProfileHeader',
				props: { id: 'tpl', showBanner: false, fullScreen: false, showAbout: false, showNip05: true, align: 'left' },
			},
		],
	},
	{
		id: 'shop',
		label: 'Shop',
		description: 'Lead with a banner, then show everything you sell in a grid.',
		defaultThemeId: 'default',
		blocks: [
			{
				type: 'ProfileHeader',
				props: { id: 'tpl', showBanner: true, fullScreen: false, showAbout: true, showNip05: true, align: 'center' },
			},
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
			{
				type: 'ProfileHeader',
				props: { id: 'tpl', showBanner: true, fullScreen: false, showAbout: false, showNip05: true, align: 'center' },
			},
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
