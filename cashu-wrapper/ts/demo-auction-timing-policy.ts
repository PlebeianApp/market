/**
 * Timing bounds shared by the Friday browser payout authorization and terminal
 * authority. They describe new seven-day listings; existing authorizations
 * remain valid because the extension and recovery offsets are unchanged.
 */
export const DEMO_MIN_AUCTION_DURATION_SECONDS = 3
export const DEMO_MAX_BASE_AUCTION_SECONDS = 7 * 24 * 60 * 60
export const DEMO_LATE_BID_WINDOW_SECONDS = 180
export const DEMO_LATE_BID_EXTENSION_SECONDS = 180
export const DEMO_MAX_EXTENSION_SECONDS = 1_800
export const DEMO_EMERGENCY_RECOVERY_SECONDS = 900
export const DEMO_EVENT_SKEW_SECONDS = 300
export const DEMO_MAIN_CUTOFF_SECONDS = 300
export const DEMO_SETTLEMENT_WINDOW_SECONDS = 600
// The absolute payment deadline remains originalEnd + extension + recovery.
// Authorization creation measures from the browser clock, so its validation
// cap also covers the consensus event-skew window accepted by the Go policy.
export const DEMO_MAX_AUTHORIZATION_SECONDS = DEMO_MAX_BASE_AUCTION_SECONDS
	+ DEMO_MAX_EXTENSION_SECONDS + DEMO_EMERGENCY_RECOVERY_SECONDS + DEMO_EVENT_SKEW_SECONDS
