import { getEventHandler } from '../EventHandler'
import type { BunRoutes } from './types'

export const nip05Routes: BunRoutes = {
	'/.well-known/nostr.json': {
		GET: (req: Request) => {
			const url = new URL(req.url)
			const name = url.searchParams.get('name') ?? undefined
			const nip05Manager = getEventHandler().getNip05Manager()
			const result = nip05Manager.buildNostrJson(name)
			return Response.json(result, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Cache-Control': 'max-age=300',
				},
			})
		},
	},
}
