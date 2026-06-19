/**
 * Auction validator entry point.
 *
 * Composes the four pieces of the daemon (state, subscriber, NUT-7
 * poller, verdict publisher) and the one-shot policy emission, then
 * starts the periodic ticks. Returns a handle the caller can use to
 * stop the daemon cleanly (Ctrl-C, hot reload, etc.).
 *
 * Shape mirrors `contextvm/server.ts`'s currency-tool registration:
 * one call, one handle, no MCP transport on the auction side. The
 * validator publishes everything via the existing relay pool.
 */

import type { NostrSigner } from '@contextvm/sdk'
import type { ApplesauceRelayPool } from '@contextvm/sdk'
import { createValidatorState, type ValidatorState } from './state'
import { createVerdictPublisher } from './publisher'
import { createNut7Poller } from './nut7Poller'
import { createValidatorSubscriber } from './subscriber'
import { publishValidatorPolicy } from './policy'
import type { ValidatorPolicyDocument } from '../../lib/auction/events'

export interface StartAuctionValidatorOptions {
	signer: NostrSigner
	relayPool: ApplesauceRelayPool
	/** Human-readable name for the kind-30441 declaration. */
	name?: string
	/** Optional policy overrides; defaults to fully permissive. */
	policy?: Partial<ValidatorPolicyDocument>
	/** NUT-7 poll interval in milliseconds. Default 30s. */
	nut7PollIntervalMs?: number
	/** Lifecycle-tick interval in milliseconds (close transitions, grief detection). Default 15s. */
	lifecycleTickMs?: number
	/** Logger override. Default `console`. */
	logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
}

export interface AuctionValidatorHandle {
	/** Stop the daemon (subscriptions + timers). */
	stop: () => Promise<void>
	/** Snapshot the live state — handy for debugging / dashboards. */
	state: ValidatorState
}

export const startAuctionValidator = async (options: StartAuctionValidatorOptions): Promise<AuctionValidatorHandle> => {
	const logger = options.logger ?? defaultLogger()
	const validatorPubkey = await options.signer.getPublicKey()
	const state = createValidatorState(validatorPubkey)

	logger.info(`[validator] starting — pubkey: ${validatorPubkey.slice(0, 16)}…`)

	// Publish the policy declaration first so any bidder reading kind-
	// 30441 events while we're booting sees us right away.
	try {
		await publishValidatorPolicy({
			signer: options.signer,
			relayPool: options.relayPool,
			name: options.name ?? 'Plebeian dev validator',
			policy: options.policy,
		})
		logger.info('[validator] policy published')
	} catch (err) {
		logger.warn('[validator] policy publish failed (continuing):', err instanceof Error ? err.message : err)
	}

	const publisher = createVerdictPublisher({ signer: options.signer, relayPool: options.relayPool })
	const subscriber = createValidatorSubscriber({
		state,
		relayPool: options.relayPool,
		publisher,
		logger,
	})
	const poller = createNut7Poller({ state, publisher, logger })

	await subscriber.start()

	// Tick timers. Lifecycle ticks (cheap) drive time-based verdict
	// transitions (close, fallback, grief); NUT-7 ticks (mint
	// round-trip) drive proof-state updates.
	const nut7Interval = options.nut7PollIntervalMs ?? 30_000
	const lifecycleInterval = options.lifecycleTickMs ?? 15_000

	const nut7Timer = setInterval(() => {
		void poller.tick().catch((err) => logger.error('[validator] nut7 tick failed:', err instanceof Error ? err.message : err))
	}, nut7Interval)

	const lifecycleTimer = setInterval(() => {
		void subscriber
			.republishAll()
			.catch((err) => logger.error('[validator] lifecycle tick failed:', err instanceof Error ? err.message : err))
	}, lifecycleInterval)

	// Kick the first NUT-7 poll immediately so we don't wait a full
	// interval for the initial state.
	void poller.tick().catch(() => undefined)

	const stop = async (): Promise<void> => {
		clearInterval(nut7Timer)
		clearInterval(lifecycleTimer)
		await subscriber.stop()
		logger.info('[validator] stopped')
	}

	return { stop, state }
}

const defaultLogger = () => ({
	info: (...args: unknown[]) => console.log(...args),
	warn: (...args: unknown[]) => console.warn(...args),
	error: (...args: unknown[]) => console.error(...args),
})
