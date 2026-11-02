import { describe, expect, test } from 'bun:test'

import { createDemoFrostStdioProcessTransport } from './demo-frost-stdio-transport'
import type {
	DemoFrostProcessBinding,
	DemoFrostProcessRoundOneRequest,
	DemoFrostProcessRoundTwoRequest,
} from './demo-frost-process-boundary'

const binding: DemoFrostProcessBinding = {
	schema: 'COCO_DEMO_FROST_PROCESS_BINDING_V1',
	participantId: 1,
	processIdentity: 'participant-one',
	committeeKeysetId: 'keyset',
	committeeKeysetVersion: '1',
	rosterDigest: '00'.repeat(32),
	policyPackageDigest: '11'.repeat(32),
	sessionId: '22'.repeat(32),
	packageDigest: '55'.repeat(32),
	digest: '66'.repeat(32),
}

const roundOne = {
	schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_REQUEST_V1',
	binding,
	policy: {},
} as DemoFrostProcessRoundOneRequest
const roundTwo = {
	schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_REQUEST_V1',
	binding,
	transcriptHash: '88'.repeat(32),
	commitments: [],
} as DemoFrostProcessRoundTwoRequest

function transport(extra: string[] = []) {
	return createDemoFrostStdioProcessTransport({
		command: [process.execPath, `${import.meta.dir}/demo-frost-stdio.fixture.ts`, ...extra],
		enrollment: {
			participantId: 1,
			processIdentity: 'participant-one',
			stateDirectory: '/var/lib/coco-demo/participant-one',
			verifyingShare: `02${'01'.repeat(32)}`,
		},
		restartCounter: 7,
	})
}

describe('persistent participant stdio process transport', () => {
	test('derives peer identity from one direct child and keeps it stable across both rounds', async () => {
		const value = transport()
		try {
			const signal = new AbortController().signal
			const first = await value.roundOne(roundOne, { signal })
			const second = await value.roundTwo(roundTwo, { signal })
			expect(first.peer).toEqual(second.peer)
			expect(first.peer.processIdentity).toBe('participant-one')
			expect(first.peer.processInstanceId).toMatch(/^participant-one:pid:\d+$/)
			expect(first.peer.restartCounter).toBe(7)
			expect(first.message.binding).toEqual(binding)
			expect(second.message.transcriptHash).toBe(roundTwo.transcriptHash)
		} finally {
			value.close()
		}
	})

	test('aborting a withheld response terminates the participant process', async () => {
		const value = transport(['--withhold'])
		const controller = new AbortController()
		const pending = value.roundOne(roundOne, { signal: controller.signal })
		controller.abort()
		await expect(pending).rejects.toThrow(/aborted/)
		await expect(value.roundOne(roundOne, { signal: new AbortController().signal })).rejects.toThrow()
	})
})
