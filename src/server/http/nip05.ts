import { getEventHandler } from '../EventHandler'
import type { BunRoutes } from './types'

export const nip05Routes: BunRoutes = {
	'/.well-known/nostr.json': {
		GET: (req: Request) => {
			const url = new URL(req.url)
			const name = url.searchParams.get('name') ?? undefined
			const handler = getEventHandler()
			const legacy = handler.getNip05Manager().buildNostrJson(name)
			const unified = handler.getStorefrontIdentityManager().buildNostrJson(name)
			const result = { names: { ...legacy.names, ...unified.names } }
			return Response.json(result, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Cache-Control': 'max-age=300',
				},
			})
		},
	},
}
