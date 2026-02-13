import { LazyImage } from '@/components/ui/lazy-image'
import { uiActions } from '@/lib/stores/ui'
import { getCollectionId, getCollectionImages, getCollectionSummary, getCollectionTitle } from '@/queries/collections.tsx'
import { profileByIdentifierQueryOptions, useProfileName } from '@/queries/profiles'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from '@tanstack/react-router'

export function CollectionCard({ collection }: { collection: NDKEvent }) {
	const title = getCollectionTitle(collection)
	const collectionId = getCollectionId(collection)
	const pubkey = collection.pubkey
	const summary = getCollectionSummary(collection)
	const images = getCollectionImages(collection)
	const { data: name, isLoading } = useProfileName(pubkey)
	const location = useLocation()

	const handleCollectionClick = () => {
		// Store the current path as the source path
		// This will also store it as originalResultsPath if not already set
		uiActions.setCollectionSourcePath(location.pathname)
	}
	const { data: profileData, isLoading: isLoadingProfile } = useQuery({
		...profileByIdentifierQueryOptions(pubkey),
		enabled: !!pubkey,
	})
	const { profile, user } = profileData || {}

	return (
		<div className="border border-zinc-800 rounded-lg bg-white shadow-sm flex flex-col" data-testid="product-card">
			{/* Square aspect ratio container for image */}
			<Link
				to={`/collection/${collectionId}`}
				className="relative aspect-square overflow-hidden border-b border-zinc-800 block"
				onClick={handleCollectionClick}
			>
				{images && images.length > 0 ? (
					<LazyImage
						src={images[0][1]}
						alt={title}
						className="rounded-t-[calc(var(--radius)-1px)] hover:scale-105 transition-transform duration-200"
						containerClassName="w-full h-full"
						aspectRatio=""
						fallback={<div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400">No image</div>}
					/>
				) : (
					<div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 rounded-lg hover:bg-gray-200 transition-colors duration-200">
						No image
					</div>
				)}
			</Link>

			<div className="p-4 flex flex-col gap-2 flex-grow">
				{/* Product title */}
				<Link to={`/collection/${collectionId}`} onClick={handleCollectionClick}>
					<h2 className="text-lg font-black border-b border-[var(--light-gray)] pb-2 overflow-hidden text-ellipsis whitespace-nowrap">
						{title}
					</h2>
					<div className="text-md font-medium">{summary}</div>
				</Link>

				{/* Add a flex spacer to push the collection author to the bottom */}
				<div className="flex-grow"></div>
				<Link to={`/profile/${pubkey}`}>
					<div className="text-sm flex flex-row items-center gap-2">
						by{' '}
						{profile?.picture && !isLoadingProfile && (
							<img
								src={profile.picture}
								alt={profile.name || 'Profile picture'}
								className="rounded-full w-1 h-1 sm:w-6 sm:h-6 border-2 border-black"
							/>
						)}
						{profile?.name && !isLoadingProfile ? (
							<div className="truncate">{profile.name}</div>
						) : (
							<div className="truncate text-gray-500">...</div>
						)}
					</div>
				</Link>
			</div>
		</div>
	)
}
