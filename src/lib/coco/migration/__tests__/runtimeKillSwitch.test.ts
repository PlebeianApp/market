import { afterEach, describe, expect, test } from 'bun:test'
import { configStore } from '@/lib/stores/config'
import { nip60Store } from '@/lib/stores/nip60'
import { InMemoryMigrationControlStore, commitCutover, type CutoverExpectedState, type MigrationControlRecord } from '..'
import { createReadyRecord } from './fixtures'

const originalConfig = configStore.state
const originalNip60 = nip60Store.state

afterEach(() => {
	configStore.setState(() => originalConfig)
	nip60Store.setState(() => originalNip60)
})

function expectedFor(record: MigrationControlRecord): CutoverExpectedState {
	return {
		namespace: record.namespace,
		account: record.account,
		environment: record.environment,
		epoch: record.epoch,
		revision: record.revision,
		phase: 'COCO_READY',
		inventoryCommitment: record.inventorySeal!.commitment,
		accountingCommitment: record.accountingReport!.commitment,
		cocoAuthorityGeneration: record.cocoAuthorityGeneration!,
		recoveryQuiescenceCommitment: record.recoveryQuiescenceCertificate!.commitment,
		legacyQuiescenceCommitment: record.legacyQuiescenceCertificate!.commitment,
	}
}

describe('legacy runtime kill switch', () => {
	test('commit proactively stops an already-open NIP-60 runtime for the exact namespace', async () => {
		const ready = await createReadyRecord()
		let stopped = 0
		let listenersRemoved = 0
		configStore.setState((state) => ({ ...state, config: { ...state.config, stage: 'production' } }))
		nip60Store.setState((state) => ({
			...state,
			account: ready.account,
			wallet: {
				stop: () => stopped++,
				removeAllListeners: () => listenersRemoved++,
			} as never,
			status: 'ready',
		}))

		const store = new InMemoryMigrationControlStore([ready])
		await commitCutover(store, expectedFor(ready))

		expect(stopped).toBe(1)
		expect(listenersRemoved).toBe(1)
		expect(nip60Store.state.wallet).toBeNull()
		expect(nip60Store.state.status).toBe('error')
	})
})
