/**
 * Hash and identity pin for the Rust FROST participant executable.
 *
 * The live signer calls this before reading any private signer state and again
 * immediately before every participant process invocation.  The pathname is
 * never sufficient authority: the authenticated DKG result supplies the
 * expected executable digest.
 */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath, type FileHandle } from 'node:fs/promises'
import { resolve } from 'node:path'

const HEX_32 = /^[0-9a-f]{64}$/
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024

export interface DemoFridayParticipantBinaryPinOptions {
	path: string
	expectedSha256: string
	trustedOwnerUid: number
	maxBytes?: number
	requireOwnerDifferentFromRuntimeUid?: boolean
}

export interface DemoFridayParticipantBinaryPin {
	path: string
	executionPath: string
	expectedSha256: string
	trustedOwnerUid: number
	maxBytes: number
	requireOwnerDifferentFromRuntimeUid: boolean
	device: string
	inode: string
	size: string
	mode: number
	mtimeNanoseconds: string
	ctimeNanoseconds: string
}

const pinnedHandles = new WeakMap<DemoFridayParticipantBinaryPin, FileHandle>()

function fail(message: string): never {
	throw new Error(`DEMO_FRIDAY_PARTICIPANT_BINARY: ${message}`)
}

function exactPath(value: string): string {
	if (!value.startsWith('/') || value === '/' || value.endsWith('/') || value.includes('//') || resolve(value) !== value) {
		fail('path is not a dedicated canonical absolute path')
	}
	return value
}

async function hashHandle(handle: FileHandle, size: bigint): Promise<string> {
	const digest = createHash('sha256')
	const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Number(size)))
	let offset = 0
	while (BigInt(offset) < size) {
		const length = Math.min(buffer.byteLength, Number(size - BigInt(offset)))
		const { bytesRead } = await handle.read(buffer, 0, length, offset)
		if (bytesRead < 1) fail('binary became shorter while hashing')
		digest.update(buffer.subarray(0, bytesRead))
		offset += bytesRead
	}
	return digest.digest('hex')
}

async function snapshot(options: DemoFridayParticipantBinaryPinOptions): Promise<{
	pin: DemoFridayParticipantBinaryPin
	digest: string
	handle: FileHandle
}> {
	const path = exactPath(options.path)
	if (!HEX_32.test(options.expectedSha256)) fail('authenticated SHA-256 is malformed')
	if (!Number.isSafeInteger(options.trustedOwnerUid) || options.trustedOwnerUid < 0) fail('trusted owner uid is invalid')
	const requireOwnerDifferentFromRuntimeUid = options.requireOwnerDifferentFromRuntimeUid ?? false
	if (requireOwnerDifferentFromRuntimeUid && options.trustedOwnerUid === process.geteuid!()) {
		fail('trusted binary owner must differ from the unprivileged runtime uid')
	}
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES) fail('binary size bound is invalid')
	let handle
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
	} catch {
		fail('binary cannot be opened without following a link')
	}
	let keepOpen = false
	try {
		const metadata = await handle.stat({ bigint: true })
		const mode = Number(metadata.mode & 0o777n)
		if (!metadata.isFile() || metadata.nlink !== 1n || metadata.uid !== BigInt(options.trustedOwnerUid)
			|| (mode & 0o111) === 0 || (mode & 0o022) !== 0 || metadata.size < 1n || metadata.size > BigInt(maxBytes)) {
			fail('binary type, owner, mode, link count, or size is unsafe')
		}
		if (await realpath(path) !== path) fail('binary or a parent path resolves through a symlink')
		const digest = await hashHandle(handle, metadata.size)
		const afterHash = await handle.stat({ bigint: true })
		if (afterHash.size !== metadata.size || afterHash.dev !== metadata.dev || afterHash.ino !== metadata.ino
			|| afterHash.mtimeNs !== metadata.mtimeNs || afterHash.ctimeNs !== metadata.ctimeNs) {
			fail('binary changed while hashing')
		}
		keepOpen = true
		return {
			digest,
			pin: {
				path, executionPath: `/proc/${process.pid}/fd/${handle.fd}`,
				expectedSha256: options.expectedSha256, trustedOwnerUid: options.trustedOwnerUid, maxBytes,
				requireOwnerDifferentFromRuntimeUid,
				device: metadata.dev.toString(), inode: metadata.ino.toString(), size: metadata.size.toString(), mode,
				mtimeNanoseconds: metadata.mtimeNs.toString(), ctimeNanoseconds: metadata.ctimeNs.toString(),
			},
			handle,
		}
	} finally {
		if (!keepOpen) await handle.close()
	}
}

export async function pinDemoFridayParticipantBinary(
	options: DemoFridayParticipantBinaryPinOptions,
): Promise<DemoFridayParticipantBinaryPin> {
	const current = await snapshot(options)
	if (current.digest !== options.expectedSha256) {
		await current.handle.close()
		fail('binary SHA-256 differs from authenticated DKG result')
	}
	const pin = Object.freeze(current.pin)
	pinnedHandles.set(pin, current.handle)
	return pin
}

export async function assertDemoFridayParticipantBinaryCurrent(pin: DemoFridayParticipantBinaryPin): Promise<void> {
	const pinned = pinnedHandles.get(pin)
	if (pinned === undefined) fail('authenticated binary descriptor is unavailable')
	const pinnedMetadata = await pinned.stat({ bigint: true })
	const pinnedDigest = await hashHandle(pinned, pinnedMetadata.size)
	let current: Awaited<ReturnType<typeof snapshot>> | undefined
	try {
		current = await snapshot(pin)
		if (pinnedDigest !== pin.expectedSha256 || current.digest !== pin.expectedSha256
			|| pinnedMetadata.dev.toString() !== pin.device || pinnedMetadata.ino.toString() !== pin.inode
			|| pinnedMetadata.size.toString() !== pin.size || Number(pinnedMetadata.mode & 0o777n) !== pin.mode
			|| pinnedMetadata.mtimeNs.toString() !== pin.mtimeNanoseconds
			|| pinnedMetadata.ctimeNs.toString() !== pin.ctimeNanoseconds
			|| current.pin.device !== pin.device || current.pin.inode !== pin.inode || current.pin.size !== pin.size
			|| current.pin.mode !== pin.mode || current.pin.mtimeNanoseconds !== pin.mtimeNanoseconds
			|| current.pin.ctimeNanoseconds !== pin.ctimeNanoseconds) {
			fail('binary changed after the authenticated startup pin')
		}
	} finally {
		if (current !== undefined) await current.handle.close()
	}
}

/** Execute this proc-fd path, never the mutable deployment pathname. */
export function demoFridayParticipantBinaryExecutionPath(pin: DemoFridayParticipantBinaryPin): string {
	if (!pinnedHandles.has(pin)) fail('authenticated binary descriptor is unavailable')
	return pin.executionPath
}

export async function closeDemoFridayParticipantBinaryPin(pin: DemoFridayParticipantBinaryPin): Promise<void> {
	const handle = pinnedHandles.get(pin)
	if (handle === undefined) return
	pinnedHandles.delete(pin)
	await handle.close()
}

/** Testable sequencing boundary used before any signer-private read or journal open. */
export async function afterDemoFridayParticipantBinaryPin<T>(
	options: DemoFridayParticipantBinaryPinOptions,
	afterVerified: (pin: DemoFridayParticipantBinaryPin) => Promise<T>,
): Promise<{ pin: DemoFridayParticipantBinaryPin; value: T }> {
	const pin = await pinDemoFridayParticipantBinary(options)
	try {
		return { pin, value: await afterVerified(pin) }
	} catch (error) {
		await closeDemoFridayParticipantBinaryPin(pin)
		throw error
	}
}

