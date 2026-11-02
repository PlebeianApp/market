import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

import {
	afterDemoFridayParticipantBinaryPin,
	assertDemoFridayParticipantBinaryCurrent,
	closeDemoFridayParticipantBinaryPin,
	demoFridayParticipantBinaryExecutionPath,
	pinDemoFridayParticipantBinary,
} from './demo-friday-participant-binary-pin'

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

describe('Friday authenticated participant executable pin', () => {
	test('rejects a digest mismatch before private state, journals, or subprocess hooks can run', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-participant-pin-'))
		const binary = join(root, 'participant')
		await writeFile(binary, 'reviewed participant bytes', { mode: 0o755 })
		let secretReads = 0; let journalOpens = 0; let subprocesses = 0
		try {
			await expect(afterDemoFridayParticipantBinaryPin({
				path: binary, expectedSha256: digest('different bytes'), trustedOwnerUid: process.geteuid!(),
			}, async () => {
				secretReads += 1; journalOpens += 1; subprocesses += 1
			})).rejects.toThrow(/SHA-256 differs/)
			expect({ secretReads, journalOpens, subprocesses }).toEqual({ secretReads: 0, journalOpens: 0, subprocesses: 0 })
		} finally { await rm(root, { recursive: true, force: true }) }
	})

	test('pins one safe executable and detects content or inode replacement before a later spawn', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-participant-pin-'))
		const binary = join(root, 'participant'); const bytes = 'reviewed participant bytes'
		await writeFile(binary, bytes, { mode: 0o755 })
		let pin
		try {
			pin = await pinDemoFridayParticipantBinary({
				path: binary, expectedSha256: digest(bytes), trustedOwnerUid: process.geteuid!(),
			})
			await expect(assertDemoFridayParticipantBinaryCurrent(pin)).resolves.toBeUndefined()
			await writeFile(binary, 'changed participant bytes', { mode: 0o755 })
			await expect(assertDemoFridayParticipantBinaryCurrent(pin)).rejects.toThrow(/changed after/)
		} finally {
			if (pin !== undefined) await closeDemoFridayParticipantBinaryPin(pin)
			await rm(root, { recursive: true, force: true })
		}
	})

	test('the execution path retains the verified inode across a pathname swap', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-participant-pin-'))
		const binary = join(root, 'participant'); const original = join(root, 'participant.original')
		await copyFile('/usr/bin/true', binary); await chmod(binary, 0o755)
		let pin
		try {
			const bytes = await Bun.file(binary).arrayBuffer()
			pin = await pinDemoFridayParticipantBinary({
				path: binary, expectedSha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
				trustedOwnerUid: process.geteuid!(),
			})
			await assertDemoFridayParticipantBinaryCurrent(pin)
			await rename(binary, original)
			await copyFile('/usr/bin/false', binary); await chmod(binary, 0o755)
			const child = Bun.spawn([demoFridayParticipantBinaryExecutionPath(pin)], { stdout: 'pipe', stderr: 'pipe' })
			expect(await child.exited).toBe(0)
			await expect(assertDemoFridayParticipantBinaryCurrent(pin)).rejects.toThrow(/changed after/)
		} finally {
			if (pin !== undefined) await closeDemoFridayParticipantBinaryPin(pin)
			await rm(root, { recursive: true, force: true })
		}
	})

	test('rejects symlinks, writable executables, and non-executable files', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-participant-pin-'))
		const binary = join(root, 'participant'); const link = join(root, 'participant-link'); const bytes = 'binary'
		await writeFile(binary, bytes, { mode: 0o755 }); await symlink(binary, link)
		const options = { expectedSha256: digest(bytes), trustedOwnerUid: process.geteuid!() }
		try {
			await expect(pinDemoFridayParticipantBinary({ path: link, ...options })).rejects.toThrow()
			await chmod(binary, 0o775)
			await expect(pinDemoFridayParticipantBinary({ path: binary, ...options })).rejects.toThrow(/unsafe/)
			await chmod(binary, 0o644)
			await expect(pinDemoFridayParticipantBinary({ path: binary, ...options })).rejects.toThrow(/unsafe/)
		} finally { await rm(root, { recursive: true, force: true }) }
	})

	test('live mode rejects an executable writable by the runtime owner', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-participant-pin-'))
		const binary = join(root, 'participant'); const bytes = 'binary'
		await writeFile(binary, bytes, { mode: 0o755 })
		try {
			await expect(pinDemoFridayParticipantBinary({
				path: binary, expectedSha256: digest(bytes), trustedOwnerUid: process.geteuid!(),
				requireOwnerDifferentFromRuntimeUid: true,
			})).rejects.toThrow(/owner must differ/)
		} finally { await rm(root, { recursive: true, force: true }) }
	})
})

