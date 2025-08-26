import { NDKEvent } from '@nostr-dev-kit/ndk'
import { getCollectionImages, getCollectionTitle } from '@/queries/collections.tsx'
import { useEffect, useState } from 'react'
import { ndkActions } from '@/lib/stores/ndk.ts'
import { uiActions } from '@/lib/stores/ui'
import { Link, useLocation } from '@tanstack/react-router'

export function CollectionCard({ collection }: { collection: NDKEvent }) {
	const title = getCollectionTitle(collection)
	const [currentUserPubkey, setCurrentUserPubkey] = useState<string | null>(null)
	const [isOwnCollection, setIsOwnCollection] = useState(false)
	const images = getCollectionImages(collection)

	// Check if current user is the creator of the collection
	useEffect(() => {
		const checkIfOwnCollection = async () => {
			const user = await ndkActions.getUser()
			if (user?.pubkey) {
				setCurrentUserPubkey(user.pubkey)
				setIsOwnCollection(user.pubkey === collection.pubkey)
			}
		}
	}, [collection.pubkey])

	const handleCollectionClick = () => {
		// Store the current path as the source path
		// This will also store it as originalResultsPath if not already set
		uiActions.setCollectionSourcePath(location.pathname)
	}

	return (
		<div className="border border-zinc-800 rounded-lg bg-white shadow-sm flex flex-col" data-testid="product-card">
			{/* Square aspect ratio container for image */}
			<Link
				to={`/collections/${collection.id}`}
				className="relative aspect-square overflow-hidden border-b border-zinc-800 block"
				onClick={handleCollectionClick}
			>
				{images && images.length > 0 ? (
					<img
						src={images[0][1]}
						alt={title}
						className="w-full h-full object-cover rounded-t-[calc(var(--radius)-1px)] hover:scale-105 transition-transform duration-200"
					/>
				) : (
					<div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 rounded-lg hover:bg-gray-200 transition-colors duration-200">
						No image
					</div>
				)}
			</Link>

			<div className="p-2 flex flex-col gap-2 flex-grow">
				{/* Product title */}
				<Link to={`/products/${collection.id}`} onClick={handleCollectionClick}>
					<h2 className="text-sm font-medium border-b border-[var(--light-gray)] pb-2 overflow-hidden text-ellipsis whitespace-nowrap">
						{title}
					</h2>
				</Link>

				{/*/!* Add a flex spacer to push the button to the bottom *!/*/}
				{/*<div className="flex-grow"></div>*/}
			</div>
		</div>
	)
}
