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
			})
		},
	},
}
