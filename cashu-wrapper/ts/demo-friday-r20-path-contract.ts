/** Immutable R20 installation and operator path contract. */

export const DEMO_FRIDAY_R20_RELEASE_ROOT =
	'/opt/plebeian-auctions-friday/releases/r20-deploy-v1' as const
export const DEMO_FRIDAY_R20_BIN_ROOT = `${DEMO_FRIDAY_R20_RELEASE_ROOT}/bin` as const
export const DEMO_FRIDAY_R20_PERMISSION_SEAL_BINARY =
	`${DEMO_FRIDAY_R20_BIN_ROOT}/plebeian-friday-r20-permission-seal` as const
export const DEMO_FRIDAY_R20_PARTICIPANT_BINARY =
	`${DEMO_FRIDAY_R20_BIN_ROOT}/coco-demo-frost-participant-3of4` as const
export const DEMO_FRIDAY_R20_INSPECTOR_BINARY =
	`${DEMO_FRIDAY_R20_BIN_ROOT}/coco-demo-frost-public-inspect` as const
export const DEMO_FRIDAY_R20_COMET_PROBE_BINARY =
	`${DEMO_FRIDAY_R20_BIN_ROOT}/plebeian-friday-comet-probe` as const
export const DEMO_FRIDAY_R20_TERMINAL_EXECUTOR_BINARY =
	`${DEMO_FRIDAY_R20_BIN_ROOT}/plebeian-friday-terminal-executor` as const
export const DEMO_FRIDAY_R20_ACCEPTANCE_OPERATOR_BINARY =
	`${DEMO_FRIDAY_R20_BIN_ROOT}/plebeian-friday-r20-acceptance-operator` as const

export const DEMO_FRIDAY_R20_COURIER_ROOT =
	'/home/maximoto/.local/state/plebeian-auctions-friday/r20-courier' as const
export const DEMO_FRIDAY_R20_COURIER_INPUT_ROOT = `${DEMO_FRIDAY_R20_COURIER_ROOT}/inputs` as const
export const DEMO_FRIDAY_R20_COURIER_OPERATOR_ROOT = `${DEMO_FRIDAY_R20_COURIER_ROOT}/operator` as const
