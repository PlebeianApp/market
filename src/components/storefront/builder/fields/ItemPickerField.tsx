import { collectionsByPubkeyQueryOptions, getCollectionId, getCollectionTitle } from '@/queries/collections'
import { getProductId, getProductTitle, productsByPubkeyQueryOptions } from '@/queries/products'
import { useQuery } from '@tanstack/react-query'
import { useStorefrontContext } from '../../StorefrontContext'

/**
 * Sidebar fields for choosing one of the author's own products or collections.
 *
 * The persisted value is the item's `d` tag, not its title: a title is display
 * text, and the repo rule is to reference items by identifier so renaming a
 * product does not silently break every page that features it.
 *
 * The dropdown is populated from the author's own listings, which also means
 * the editor cannot express a reference to somebody else's item — the same
 * guarantee the renderer enforces, made visible in the UI.
 */

const selectClassName =
	'w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary'

function FieldShell({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
			{label}
			{children}
		</label>
	)
}

export function ProductPickerField({
	label,
	value,
	onChange,
	readOnly,
}: {
	label: string
	value: string
	onChange: (value: string) => void
	readOnly?: boolean
}) {
	const { pubkey } = useStorefrontContext()
	const { data: products, isLoading } = useQuery(productsByPubkeyQueryOptions(pubkey))

	const options = (products ?? []).map((product) => ({
		value: getProductId(product),
		label: getProductTitle(product) || getProductId(product),
	}))

	// A value pointing at something no longer listed must stay selectable, or
	// opening the editor would silently rewrite the page to the first product
	// in the list. Show it, marked, and let the author decide.
	const hasCurrent = value.length > 0 && options.some((option) => option.value === value)

	return (
		<FieldShell label={label}>
			<select className={selectClassName} value={value} disabled={readOnly} onChange={(event) => onChange(event.target.value)}>
				<option value="">{isLoading ? 'Loading your products…' : 'Select a product…'}</option>
				{!hasCurrent && value.length > 0 && <option value={value}>{value} (not currently listed)</option>}
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			{!isLoading && options.length === 0 && <span className="text-[11px] font-normal">You have no published products yet.</span>}
		</FieldShell>
	)
}

export function CollectionPickerField({
	label,
	value,
	onChange,
	readOnly,
}: {
	label: string
	value: string
	onChange: (value: string) => void
	readOnly?: boolean
}) {
	const { pubkey } = useStorefrontContext()
	const { data: collections, isLoading } = useQuery(collectionsByPubkeyQueryOptions(pubkey))

	const options = (collections ?? []).map((collection) => ({
		value: getCollectionId(collection),
		label: getCollectionTitle(collection) || getCollectionId(collection),
	}))

	const hasCurrent = value.length > 0 && options.some((option) => option.value === value)

	return (
		<FieldShell label={label}>
			<select className={selectClassName} value={value} disabled={readOnly} onChange={(event) => onChange(event.target.value)}>
				<option value="">{isLoading ? 'Loading your collections…' : 'Select a collection…'}</option>
				{!hasCurrent && value.length > 0 && <option value={value}>{value} (not found)</option>}
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			{!isLoading && options.length === 0 && <span className="text-[11px] font-normal">You have no collections yet.</span>}
		</FieldShell>
	)
}
