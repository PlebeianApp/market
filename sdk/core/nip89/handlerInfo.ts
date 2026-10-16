import type { EventPublishContext } from '../ports/eventPublish'
import type { SignedEventLike } from '../ports/signer'
import { addressableCoordinate, signAndPublish, type UnsignedEventData } from '../publishing'

export const HANDLER_INFO_KIND = 31990
const HANDLED_KINDS = [30402, 30405] as const

// Frozen software identity (ADR-018): names the code, not the deployment, so it must not come from instance config.
export const NIP89_CLIENT_SOFTWARE_NAME = 'Plebeian Market'

export interface HandlerInfoInput {
	handlerId: string
	siteUrl: string
	/** Adds an `r` relay hint when present. */
	relayUrl?: string
	/** Legacy: app settings carried as handler content; NIP-89 content is otherwise empty. */
	appSettings?: Record<string, unknown>
}

export function buildHandlerInfoEventData(input: HandlerInfoInput): UnsignedEventData {
	const tags: string[][] = [
		['d', input.handlerId],
		...HANDLED_KINDS.map((kind) => ['k', kind.toString()]),
		['web', `${input.siteUrl}/product/<bech32>`, 'naddr'],
		['web', `${input.siteUrl}/a/<bech32>`, 'naddr'],
		['web', `${input.siteUrl}/collection/<bech32>`, 'naddr'],
	]
	if (input.relayUrl) tags.push(['r', input.relayUrl])

	return { kind: HANDLER_INFO_KIND, content: input.appSettings ? JSON.stringify(input.appSettings) : '', tags }
}

/** NIP-89 `client` tag pointing at the instance's handler event. */
export function buildClientTag(appPubkey: string, handlerId: string, relayUrl: string): [string, string, string, string] {
	return ['client', NIP89_CLIENT_SOFTWARE_NAME, addressableCoordinate(HANDLER_INFO_KIND, appPubkey, handlerId), relayUrl]
}

export async function publishHandlerInfoWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	input: HandlerInfoInput,
): Promise<{ event: SignedEvent; handlerId: string }> {
	const event = await signAndPublish(context, buildHandlerInfoEventData(input))
	return { event, handlerId: input.handlerId }
}
