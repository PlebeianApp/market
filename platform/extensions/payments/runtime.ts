import type { ExtensionPaymentRequirement } from '@sdk/core/extensions'
import type { CollectedPaymentEvent } from '../actionRoute'
import { createRoutstrdCollector, type CashuCollector } from './collector'

export const DEFAULT_ROUTSTRD_URL = 'http://127.0.0.1:8008'
const MINTS_REFRESH_MS = 60_000

export interface PaymentCollectorRuntime {
	collector: CashuCollector
	/** Completes a marketplace-collected price with the collector's mints; `undefined` hides the action. */
	resolve(requirement: ExtensionPaymentRequirement): ExtensionPaymentRequirement | undefined
	record(event: CollectedPaymentEvent): void
	stop(): void
}

/**
 * `EXTENSIONS_PAYMENT_COLLECTOR=routstrd` enables marketplace-collected payments into the local routstrd wallet
 * (`EXTENSIONS_ROUTSTRD_URL`, default http://127.0.0.1:8008). Unset means priced marketplace actions are hidden.
 */
export function createPaymentCollectorRuntime(
	env: Readonly<Record<string, string | undefined>>,
	options: { collector?: CashuCollector; log?: (line: string) => void } = {},
): PaymentCollectorRuntime | undefined {
	const kind = env.EXTENSIONS_PAYMENT_COLLECTOR?.trim()
	if (!kind && !options.collector) return undefined
	const log = options.log ?? ((line: string) => console.info(line))
	let collector: CashuCollector
	try {
		if (options.collector) collector = options.collector
		else if (kind === 'routstrd') collector = createRoutstrdCollector(env.EXTENSIONS_ROUTSTRD_URL?.trim() || DEFAULT_ROUTSTRD_URL)
		else throw new Error(`Unknown EXTENSIONS_PAYMENT_COLLECTOR: ${kind}`)
	} catch (error) {
		console.error(`[extensions] payment collector disabled: ${error instanceof Error ? error.message : 'invalid configuration'}`)
		return undefined
	}

	let mints: string[] = []
	const refresh = () =>
		collector
			.acceptedMints()
			.then((next) => {
				mints = next
			})
			.catch(() => {
				// Keep the last known list; a down wallet surfaces as unavailable at request time.
			})
	void refresh()
	const timer = setInterval(() => void refresh(), MINTS_REFRESH_MS)
	timer.unref?.()

	return {
		collector,
		resolve(requirement) {
			if (requirement.collectedBy !== 'marketplace') return requirement
			if (mints.length === 0) return undefined
			return { ...requirement, mints: mints.slice(0, 10) }
		},
		record(event) {
			// A ledger line per payment event; never token contents.
			const fields = [
				`outcome=${event.outcome}`,
				`ext=${event.extensionId}.${event.actionName}`,
				`pubkey=${event.pubkey}`,
				event.sats !== undefined ? `sats=${event.sats}` : '',
				event.mint ? `mint=${event.mint}` : '',
				event.reason ? `reason=${event.reason}` : '',
			].filter(Boolean)
			const line = `[extensions:payments] ${fields.join(' ')}`
			if (event.outcome === 'refund_failed' || event.outcome === 'change_failed') console.error(`${line} (owed to the seller)`)
			else log(line)
		},
		stop() {
			clearInterval(timer)
		},
	}
}
