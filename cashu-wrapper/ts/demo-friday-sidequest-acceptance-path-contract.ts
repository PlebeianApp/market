/**
 * Immutable, acceptance-only Sidequest tooling paths.
 *
 * These executables are operator/probe tools.  They are deliberately kept out
 * of both the frozen separated-deploy-v1 predecessor and the active
 * sidequest-mvp-r4 application release.  Installing this create-once release
 * never changes a systemd unit or an application executable.
 */

export const DEMO_FRIDAY_SIDEQUEST_ACCEPTANCE_RELEASE_ROOT =
	'/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-acceptance-r1' as const
export const DEMO_FRIDAY_SIDEQUEST_ACCEPTANCE_BIN_ROOT =
	`${DEMO_FRIDAY_SIDEQUEST_ACCEPTANCE_RELEASE_ROOT}/bin` as const
export const DEMO_FRIDAY_SIDEQUEST_COMET_PROBE_BINARY =
	`${DEMO_FRIDAY_SIDEQUEST_ACCEPTANCE_BIN_ROOT}/plebeian-friday-comet-probe` as const
export const DEMO_FRIDAY_SIDEQUEST_ACCEPTANCE_OPERATOR_BINARY =
	`${DEMO_FRIDAY_SIDEQUEST_ACCEPTANCE_BIN_ROOT}/plebeian-friday-r20-acceptance-operator` as const
