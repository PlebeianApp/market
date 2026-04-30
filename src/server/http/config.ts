import {
	determineStage,
	getAppPublicKeyOrThrow,
	getAppSettings,
	getCvmServerPublicKey,
	isEventHandlerReady,
	NIP46_RELAY_URL,
	RELAY_URL,
} from '../runtime'
import type { BunRoutes } from './types'

export const configRoutes: BunRoutes = {
	'/api/config': {
		GET: () => {
			return Response.json({
				appRelay: RELAY_URL,
				stage: determineStage(),
				nip46Relay: NIP46_RELAY_URL,
				appSettings: getAppSettings(),
				appPublicKey: getAppPublicKeyOrThrow(),
				cvmServerPubkey: getCvmServerPublicKey(),
				needsSetup: !getAppSettings(),
				serverReady: isEventHandlerReady(),
			})
		},
	},
}
