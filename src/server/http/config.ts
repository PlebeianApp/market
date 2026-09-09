import {
	determineStage,
	getAppPublicKeyOrThrow,
	getAppSettings,
	getInstanceConfig,
	resolveCvmServerPubkey,
	isEventHandlerReady,
	NIP46_RELAY_URL,
	RELAY_URL,
} from '../runtime'
import type { PublicAppConfig } from '@/lib/instance-config'
import type { BunRoutes } from './types'

export const configRoutes: BunRoutes = {
	'/api/config': {
		GET: () => {
			const appSettings = getAppSettings()
			const stage = determineStage()
			const config: PublicAppConfig = {
				...getInstanceConfig(),
				appRelay: RELAY_URL as string,
				stage,
				nip46Relay: NIP46_RELAY_URL,
				appSettings,
				appPublicKey: getAppPublicKeyOrThrow(),
				cvmServerPubkey: resolveCvmServerPubkey(),
				needsSetup: !appSettings,
				serverReady: isEventHandlerReady(),
				externalZapRelaysEnabled: stage === 'production' || (stage === 'development' && process.env.LOCAL_RELAY_ONLY !== 'true'),
			}
			return Response.json(config)
		},
	},
}
