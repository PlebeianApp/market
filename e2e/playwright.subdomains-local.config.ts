import config from './playwright.config'
import { BASE_URL } from './test-config'

process.env.E2E_STOREFRONT_SUBDOMAINS = 'true'

export default {
	...config,
	webServer: Array.isArray(config.webServer)
		? config.webServer
				.filter((server) => server.port !== 3338)
				.map((server) => ({
					...server,
					env: { ...server.env, INSTANCE_STOREFRONT_BASE_URL: BASE_URL },
				}))
		: config.webServer,
}
