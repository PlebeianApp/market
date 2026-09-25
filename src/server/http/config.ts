import { Relay } from 'nostr-tools'
import type { NostrEvent } from '@nostr-dev-kit/ndk'
import {
	determineStage,
	getAppPublicKeyOrThrow,
	getAppSettings,
	getInstanceConfig,
	resolveCvmServerPubkey,
	isEventHandlerReady,
	NIP46_RELAY_URL,
	RELAY_URL,
	setAppSettings,
} from '../runtime'
import { getEventHandler } from '../EventHandler'
import type { PublicAppConfig } from '@/lib/instance-config'
import { AppSettingsSchema } from '@/lib/schemas/app'
import type { BunRoutes } from './types'

interface BootstrapSetupRequest {
	settings: unknown
	admins: unknown
	editors: unknown
}

function isHexPubkey(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
}

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
	'/api/setup': {
		POST: async (request) => {
			if (!isEventHandlerReady()) return Response.json({ error: 'Server is still initializing' }, { status: 503 })

			const handler = getEventHandler()
			if (!handler.isBootstrapMode()) return Response.json({ error: 'Initial setup is no longer available' }, { status: 403 })

			let payload: BootstrapSetupRequest
			try {
				payload = (await request.json()) as BootstrapSetupRequest
			} catch {
				return Response.json({ error: 'Invalid JSON request body' }, { status: 400 })
			}

			const settingsResult = AppSettingsSchema.safeParse(payload.settings)
			if (!settingsResult.success || !isHexPubkey(settingsResult.data.ownerPk)) {
				return Response.json({ error: 'Invalid app settings or owner public key' }, { status: 400 })
			}

			if (
				!Array.isArray(payload.admins) ||
				!payload.admins.every(isHexPubkey) ||
				!Array.isArray(payload.editors) ||
				!payload.editors.every(isHexPubkey)
			) {
				return Response.json({ error: 'Invalid admin or editor public key' }, { status: 400 })
			}

			const appPubkey = getAppPublicKeyOrThrow()
			const timestamp = Math.floor(Date.now() / 1000)
			const eventTemplates = [
				{ kind: 30000, created_at: timestamp, tags: [['d', 'admins'], ...payload.admins.map((pubkey) => ['p', pubkey])], content: '' },
				{ kind: 30000, created_at: timestamp, tags: [['d', 'editors'], ...payload.editors.map((pubkey) => ['p', pubkey])], content: '' },
				{
					kind: 31990,
					created_at: timestamp,
					tags: [['d', settingsResult.data.handlerId || 'plebeian-market-handler']],
					content: JSON.stringify(settingsResult.data),
				},
			]

			const signedEvents = eventTemplates.map((template) => {
				const processed = handler.processEvent({ ...template, pubkey: appPubkey } as NostrEvent)
				if (!processed.signedEvent) throw new Error(processed.validationResult.reason || 'Setup event was rejected')
				return processed.signedEvent
			})

			try {
				const relay = await Relay.connect(RELAY_URL as string)
				for (const event of signedEvents) await relay.publish(event as Parameters<typeof relay.publish>[0])
				relay.close()
				setAppSettings(settingsResult.data)
				return Response.json({ ok: true })
			} catch (error) {
				return Response.json({ error: error instanceof Error ? error.message : 'Failed to publish setup events' }, { status: 502 })
			}
		},
	},
}
