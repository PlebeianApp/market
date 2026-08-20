import { getEventHandler } from '../EventHandler'
import {
	determineStage,
	getAppPublicKeyOrThrow,
	getAppSettings,
	resolveCvmServerPubkey,
	isEventHandlerReady,
	NIP46_RELAY_URL,
	RELAY_URL,
} from '../runtime'
import type { BunRoutes } from './types'

export const configRoutes: BunRoutes = {
	'/api/config': {
		GET: () => {
			const stage = determineStage()
			// Report the *effective* whitelist config from the manager — the
			// same normalized value validation enforces (e.g. an unset or
			// misspelled AUCTION_WHITELIST_MODE shows up as 'open').
			const auctionWhitelist = getEventHandler().getAuctionWhitelist().getConfig()
			return Response.json({
				appRelay: RELAY_URL,
				stage,
				nip46Relay: NIP46_RELAY_URL,
				appSettings: getAppSettings(),
				appPublicKey: getAppPublicKeyOrThrow(),
				cvmServerPubkey: resolveCvmServerPubkey(),
				needsSetup: !getAppSettings(),
				serverReady: isEventHandlerReady(),
				externalZapRelaysEnabled: stage === 'production' || (stage === 'development' && process.env.LOCAL_RELAY_ONLY !== 'true'),
				auctionWhitelist,
			})
		},
	},
}
