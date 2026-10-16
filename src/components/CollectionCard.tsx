import { uiActions } from '@/lib/stores/ui'
import { Media } from '@ui/components/Media'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { Link, useLocation } from '@tanstack/react-router'
import { UserCard } from './UserCard'
import { CollectionCardView } from '@ui/components/CollectionCardView'

export function CollectionCard({ collection, className }: { collection: NDKEvent } & React.HTMLAttributes<HTMLDivElement>) {
	const location = useLocation()

	const handleCollectionClick = () => {
		// Store the current path as the source path
		// This will also store it as originalResultsPath if not already set
		uiActions.setCollectionSourcePath(location.pathname)
	}
	return (
		<CollectionCardView
			collection={collection}
			className={className}
			renderLink={(children, collectionId, linkClassName) => (
				<Link to={`/collection/${collectionId}`} className={linkClassName} onClick={handleCollectionClick}>
					{children}
				</Link>
			)}
			renderImage={(src, alt) => (
				<Media
					src={src}
					alt={alt}
					className="h-full w-full rounded-t-[calc(var(--radius)-1px)] object-cover transition-transform duration-200 hover:scale-105"
				/>
			)}
			renderSeller={<UserCard pubkey={collection.pubkey} size="xs" />}
			data-testid="collection-card"
		/>
	)
}
