/**
 * Single-decision policy for the bounded author-relay path (ADR-0002 Wave 1
 * addendum, F3).
 *
 * F3 follows ADR-016's shape: the SERVER computes one boolean and the browser
 * consumes it, so there is no second stage check to drift from. The server-side
 * arm cannot read the `/api/config` response it produces, so it derives the
 * value from its own inputs through the same function below.
 *
 * Policy: the bounded author-relay path may be enabled in **production only**.
 * It is OFF in staging, development, `LOCAL_RELAY_ONLY`, and CI (`NODE_ENV=test`
 * resolves to the development stage), and it is OFF whenever the stage is
 * unknown — an unrecognised stage must never enable extra egress.
 *
 * The authority carve-out is a separate, stronger rule and does not depend on
 * the flag at all: an authority read (app config, admin/editor/blacklist,
 * settlement) is never a candidate for author relays.
 */

/** Read purposes that may consult author relays. */
export type AuthorRelayReadPurpose = 'display' | 'self' | 'authority'

/** Stage values the deployment recognises (mirrors `determineStage()`). */
export type DeploymentStage = 'production' | 'staging' | 'development'

export interface ExternalAuthorReadsPolicyInput {
	/** Deployment stage; anything other than `production` disables the path. */
	stage: DeploymentStage | string | undefined
	/** `LOCAL_RELAY_ONLY=true` (CI/E2E and local-only runs). */
	localRelayOnly: boolean
}

/**
 * The server's single decision: ON in production, OFF everywhere else.
 *
 * `LOCAL_RELAY_ONLY` wins over the stage so a production-shaped local run
 * (`start:local-only`) never opens author-relay connections.
 */
export function resolveExternalAuthorReadsEnabled(input: ExternalAuthorReadsPolicyInput): boolean {
	return input.stage === 'production' && input.localRelayOnly !== true
}

/**
 * Client side: consume the single server decision. A config that is missing,
 * unreadable, or lacking the field defaults to OFF (fail closed) — a client
 * that cannot read the decision must never open extra egress.
 */
export function isExternalAuthorReadsEnabledFromConfig(config: unknown): boolean {
	if (!config || typeof config !== 'object') return false
	return (config as { externalAuthorReadsEnabled?: unknown }).externalAuthorReadsEnabled === true
}

/**
 * Authority carve-out, applied independently on both arms and on every code
 * path that could reach the resolver: authority reads never consult author
 * relays, whether the flag is ON or OFF. Only `display` (third-party display
 * data) and `self` (the reader's own events) are candidates, and only when the
 * single decision is ON.
 */
export function isAuthorRelayReadAllowed(purpose: AuthorRelayReadPurpose, externalAuthorReadsEnabled: boolean): boolean {
	if (purpose === 'authority') return false
	return externalAuthorReadsEnabled === true
}
