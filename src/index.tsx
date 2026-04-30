/**
 * Bun server entrypoint. The actual server composition lives in
 * `src/server/` — this file just wires the SPA shell, kicks off
 * initialisation, and exports the resulting Bun server instance.
 *
 * Anything bigger than a few lines belongs in a domain module under
 * `src/server/` so this file stays a glance-able overview.
 */

import { config } from 'dotenv'
import index from './index.html'
import { buildServer, initializeAppSettings, startEventHandlerInitialization } from './server'

import.meta.hot.accept()

config()

// `serve()` requires the runtime singletons (NDK, app pubkey, app settings,
// bid-token listener) to be ready before any handler runs. We can't use
// top-level await here (tsconfig target predates ES2022) so the IIFE
// pattern is preserved from the previous shape — the server is exported
// via a deferred binding.
type ResolvedServer = ReturnType<typeof buildServer>
let resolvedServer: ResolvedServer | undefined
export const serverPromise: Promise<ResolvedServer> = (async () => {
	await initializeAppSettings()
	// Heavy relay-dependent EventHandler bootstrap runs in parallel with
	// HTTP serving — relay timeouts shouldn't block the setup form.
	void startEventHandlerInitialization()
	resolvedServer = buildServer({ indexHtml: index })
	console.log(`🚀 Server running at ${resolvedServer.url}`)
	return resolvedServer
})()

/**
 * Synchronous accessor for code that only runs after init resolves
 * (e.g. tests, hot-reload helpers). Throws if the server hasn't been
 * built yet.
 */
export const getServer = (): ResolvedServer => {
	if (!resolvedServer) throw new Error('Server is not ready yet — await serverPromise first')
	return resolvedServer
}

export type NostrMessage = ['EVENT', import('nostr-tools/pure').Event]
