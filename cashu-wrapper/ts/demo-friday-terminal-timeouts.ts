/** Reviewed terminal timeout ladder: server must finish before each outer caller. */
export const DEMO_FRIDAY_SIGNER_REQUEST_TIMEOUT_MS = 30_000 as const
export const DEMO_FRIDAY_TERMINAL_PROCESS_TIMEOUT_MS = 35_000 as const
export const DEMO_FRIDAY_TERMINAL_FEDERATION_TIMEOUT_MS = 40_000 as const

export function assertDemoFridayTerminalTimeoutOrder(): void {
	if (!(DEMO_FRIDAY_SIGNER_REQUEST_TIMEOUT_MS < DEMO_FRIDAY_TERMINAL_PROCESS_TIMEOUT_MS
		&& DEMO_FRIDAY_TERMINAL_PROCESS_TIMEOUT_MS < DEMO_FRIDAY_TERMINAL_FEDERATION_TIMEOUT_MS)) {
		throw new Error('DEMO_FRIDAY_TERMINAL_TIMEOUTS: timeout order is invalid')
	}
}
