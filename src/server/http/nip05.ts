import { getEventHandler } from '../EventHandler'
import type { BunRoutes } from './types'

export const nip05Routes: BunRoutes = {
	'/.well-known/nostr.json': {
		GET: (req: Request) => {
			const url = new URL(req.url)
			const name = url.searchParams.get('name') ?? undefined
			const eventHandler = getEventHandler()
			const unified = eventHandler.getStorefrontManager().buildNostrJson(name)
			const legacy = eventHandler.getNip05Manager().buildNostrJson(name)
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
