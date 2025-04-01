import { profileQueryOptions } from '@/queries/profiles'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/profile/$npub')({
	component: RouteComponent,
})

function RouteComponent() {
	type Params = { npub: string }
	const params = Route.useParams() as Params
	const { data: profile } = useSuspenseQuery(profileQueryOptions(params.npub))

	return (
		<div className="p-4">
			<Link to="/" className="text-sm text-blue-500 underline mb-2 block">
				Back to home
			</Link>
			{profile && (
				<div>
					<h1 className="text-2xl font-bold">{profile.name || 'Anonymous User'}</h1>
					{profile.picture && <img src={profile.picture} alt={profile.name || 'Profile picture'} className="w-24 h-24 rounded-full my-4" />}
					{profile.about && <p className="text-gray-700 mt-2">{profile.about}</p>}
					{profile.nip05 && <p className="text-sm text-gray-500 mt-1">NIP-05: {profile.nip05}</p>}
				</div>
			)}
		</div>
	)
}
