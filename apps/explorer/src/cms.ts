/**
 * A minimal CMS composition — the second projection.
 *
 * This is NOT Puck. It is the smallest thing that demonstrates the claim the CMS design rests on:
 * **the editor is generic over component manifests.** Nothing here knows what a product grid is; it
 * reads a declaration, maps declared arguments to props, maps declared data requirements to filters,
 * and renders. Adding a component means adding a manifest, not editing this file.
 *
 * Compare with the prototype: `src/config/cms.tsx` hand-writes a `fields` block per component AND the
 * component hand-writes a prop interface, with nothing checking that the two agree
 * (`component-manifest-and-cms-contract.md` §2).
 */
import type { ProductListing } from '@plebeian/product'
import { collectionByDTagFilter, feedFilter, type QueryFilter } from '@plebeian/product'
import type { ModuleEnvironment } from '@plebeian/contract'

/** Section 1 of a manifest: what the component depends on. */
export interface ManifestDependencies {
	packages: readonly string[]
	renderers: readonly string[]
}

/** Section 3: the component's arguments, with types the CMS can turn into fields. */
export type ArgumentField =
	| { type: 'string'; default: string; label: string }
	| { type: 'number'; default: number; label: string }
	| { type: 'boolean'; default: boolean; label: string }
	| { type: 'enum'; default: string; options: readonly string[]; label: string }

/** Section 4: what the component needs from Nostr. A component declares; it never fetches. */
export interface DataRequirement {
	kinds: readonly number[]
	limit: number
	/** When true, a `category` argument narrows the read with a `#t` filter. */
	usesCategoryTag?: boolean
}

export interface ComponentManifest<Args extends Record<string, unknown> = Record<string, unknown>> {
	name: string
	label: string
	dependencies: ManifestDependencies
	arguments: { [K in keyof Args]: ArgumentField }
	dataRequirements: DataRequirement
}

/** The page definition the CMS stores and the assembler reads. */
export interface PageBlock {
	component: string
	args: Record<string, unknown>
}

export interface PageDefinition {
	title: string
	blocks: readonly PageBlock[]
}

// --- the manifests --------------------------------------------------------------------------

export const productGridManifest: ComponentManifest<{ title: string; category: string; showOutOfStock: boolean }> = {
	name: 'product-grid',
	label: 'Product grid',
	dependencies: {
		packages: ['@plebeian/product', '@plebeian/browse'],
		renderers: ['react'],
	},
	arguments: {
		title: { type: 'string', default: 'Products', label: 'Heading' },
		category: { type: 'string', default: '', label: 'Category (#t)' },
		showOutOfStock: { type: 'boolean', default: false, label: 'Show out-of-stock items' },
	},
	dataRequirements: { kinds: [30402], limit: 40, usesCategoryTag: true },
}

export const collectionManifest: ComponentManifest<{ dTag: string; title: string }> = {
	name: 'collection',
	label: 'Collection',
	dependencies: {
		packages: ['@plebeian/product', '@plebeian/browse'],
		renderers: ['react'],
	},
	arguments: {
		dTag: { type: 'string', default: '', label: 'Collection identifier' },
		title: { type: 'string', default: 'Collection', label: 'Heading' },
	},
	dataRequirements: { kinds: [30405], limit: 1 },
}

export const registry: readonly ComponentManifest[] = [productGridManifest, collectionManifest]

export const findManifest = (name: string): ComponentManifest | undefined => registry.find((m) => m.name === name)

/**
 * Turn a manifest's declared data requirements into a filter.
 *
 * This is the piece that makes the CMS safe: the *manifest* decides what is asked for, and the
 * component never constructs a filter. If a component wants different data, it changes its
 * declaration, and every host sees the change.
 */
export const filterForManifest = (manifest: ComponentManifest, args: Record<string, unknown>): QueryFilter => {
	if (manifest.name === 'collection') {
		return collectionByDTagFilter(String(args.dTag ?? ''))
	}
	return feedFilter({
		limit: manifest.dataRequirements.limit,
		tag: manifest.dataRequirements.usesCategoryTag ? String(args.category ?? '') || undefined : undefined,
	})
}

/** A CMS field descriptor generated from the manifest — the type-to-widget mapping, in miniature. */
export const fieldsFor = (manifest: ComponentManifest): Array<{ key: string; field: ArgumentField }> =>
	Object.entries(manifest.arguments).map(([key, field]) => ({ key, field: field as ArgumentField }))

/** Resolve every block's data, so the renderer receives validated listings and no fetching. */
export const resolvePageData = async (
	page: PageDefinition,
	env: ModuleEnvironment,
	parse: (raw: unknown) => { ok: true; value: ProductListing } | { ok: false },
): Promise<Map<number, ProductListing[]>> => {
	const resolved = new Map<number, ProductListing[]>()
	await Promise.all(
		page.blocks.map(async (block, index) => {
			const manifest = findManifest(block.component)
			if (!manifest || !manifest.dependencies.packages.includes('@plebeian/product')) {
				resolved.set(index, [])
				return
			}
			const result = await env.nostr.read([filterForManifest(manifest, block.args)])
			if (!result.ok) {
				resolved.set(index, [])
				return
			}
			const listings: ProductListing[] = []
			for (const raw of result.events) {
				const parsed = parse(raw)
				if (parsed.ok) listings.push(parsed.value)
			}
			resolved.set(index, listings)
		}),
	)
	return resolved
}
