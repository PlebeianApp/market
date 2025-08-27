import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { collectionQueryOptions,useCollectionTitle } from '@/queries/collections.tsx'
import { useSuspenseQuery } from '@tanstack/react-query'

declare module '@tanstack/react-router' {
	interface FileRoutesByPath {
		'/collection/collectionId': {
			loader: (params: { collectionId: string }) => { collectionId: string }
		}
	}
}

export const Route = createFileRoute('/collection/$collectionId')({
	component: RouteComponent,
	loader: ({ params: { collectionId } }) => {
		return { collectionId }
	},
})

function RouteComponent() {
	const { collectionId } = Route.useLoaderData()
	const { data: collection } = useSuspenseQuery(collectionQueryOptions(collectionId))

	return <div className="p-4">{collection?.id}</div>
}
