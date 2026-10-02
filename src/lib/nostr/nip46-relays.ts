import { DEFAULT_NIP46_RELAYS } from '@/lib/constants'

export interface Nip46RelayOption {
	value: string
	label: string
}

const labelFor = (url: string): string => url.replace(/^wss?:\/\//, '').replace(/\/+$/, '')

/**
 * Relay options for the Nostr Connect QR lane.
 *
 * The server advertises its NIP-46 relay on `/api/config` (`nip46Relay`) — the
 * preview and the deploy workflows each set it explicitly. The QR component
 * previously used only the hardcoded `DEFAULT_NIP46_RELAYS`, so the server
 * value was dead config: every environment silently fell back to the
 * production relay (`DEFAULT_NIP46_RELAYS[0]`) and no deployment could choose
 * its own. Put the server relay first (deduped against the defaults) so it
 * becomes the default pick.
 */
export function nip46RelayOptions(serverRelay?: string): Nip46RelayOption[] {
	const options: Nip46RelayOption[] = []
	const seen = new Set<string>()
	const add = (value: string, label?: string) => {
		const normalized = value.trim()
		if (!normalized || seen.has(normalized)) return
		seen.add(normalized)
		options.push({ value: normalized, label: label ?? labelFor(normalized) })
	}

	if (serverRelay) add(serverRelay)
	for (const relay of DEFAULT_NIP46_RELAYS) add(relay.value, relay.label)
	return options
}
