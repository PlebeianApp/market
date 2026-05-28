import type { CMSProductGridItem } from './CMSProductGridItem'

export interface FeaturedProductCardBaseProps {
	loading: boolean
	error?: string
	items?: CMSProductGridItem[]
	showPrice?: boolean
	showDescriptionSnippet?: boolean
}

export const FeaturedProductCardBase: React.FC<FeaturedProductCardBaseProps> = ({
	items,
	error = undefined,
	loading = false,
	showPrice = true,
	showDescriptionSnippet = true,
}) => {
	if (loading) return <div>Loading...</div>
	if (error) return <div>{error}</div>
	if (!items || items.length === 0) return <div>No products found.</div>

	const item = items[0]

	return (
		<div className="max-w-md mx-auto border rounded-lg overflow-hidden shadow-lg">
			{item.image && <img src={item.image} alt={item.title} className="w-full h-64 object-cover" />}
			<div className="p-6">
				<h2 className="text-2xl font-bold mb-2">{item.title}</h2>
				{showDescriptionSnippet && item.summary && <p className="text-gray-600 mb-4 line-clamp-3">{item.summary}</p>}
				{showPrice && item.price && (
					<p className="text-xl font-bold text-green-600">
						{item.price} {item.currency || 'SATS'}
					</p>
				)}
			</div>
		</div>
	)
}
