import { serve } from 'bun'
import index from './index.html'

const server = serve({
	routes: {
		// Serve index.html for all unmatched routes.
		'/*': index,

		'/api/config': {
			GET: () =>
				Response.json({
					appRelay: process.env.APP_RELAY_URL,
				}),
		},
	},

	development: process.env.NODE_ENV !== 'production',
})

console.log(`🚀 Server running at ${server.url}`)
