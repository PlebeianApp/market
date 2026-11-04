/** Exact public identity for the reviewed separated fake-sat deployment. */
export const SEPARATED_DEPLOYMENT_ID = 'friday-demo-20261030-separated-v1' as const
export const SEPARATED_APPLICATION_RUN_ID = `${SEPARATED_DEPLOYMENT_ID}-run1` as const
export const SEPARATED_DKG_RUN_ID = `${SEPARATED_DEPLOYMENT_ID}-dkg1` as const
export const SEPARATED_PUBLIC_ORIGIN = 'https://139.162.161.233' as const

export const SEPARATED_RELEASE_ROOT='/opt/plebeian-auctions-friday/releases/separated-deploy-v1' as const
export const SEPARATED_PARTICIPANT_BINARY=`${SEPARATED_RELEASE_ROOT}/bin/coco-demo-frost-participant-3of4` as const
export const SEPARATED_INSPECTOR_BINARY=`${SEPARATED_RELEASE_ROOT}/bin/coco-demo-frost-public-inspect` as const
export const SEPARATED_EXECUTOR_BINARY=`${SEPARATED_RELEASE_ROOT}/bin/plebeian-friday-terminal-executor` as const
export const SEPARATED_SUCCESSOR_EXECUTOR_BINARY='/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/plebeian-friday-terminal-executor' as const
export const SEPARATED_R10_EXECUTOR_BINARY='/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-backend-r10/bin/plebeian-friday-terminal-executor' as const

// Dedicated private parent contains durable init/recovery locks and staging.
export const SEPARATED_COORDINATOR_PARENT='/var/lib/plebeian-auctions-friday/coordinator-v3' as const
export const SEPARATED_COORDINATOR_ROOT=`${SEPARATED_COORDINATOR_PARENT}/runtime` as const
