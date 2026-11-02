/** One process and one bounded mutation interval for the shared signer stores. */
import { dirname } from 'node:path'
import { dlopen, FFIType } from 'bun:ffi'
import { closeSync, constants, fsyncSync, lstatSync, openSync, writeSync } from 'node:fs'
const libc = dlopen('libc.so.6', { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } })
export interface DemoSignerSerialization {
	run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T>
	check(mode?: 'read-only'): void
	observe<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T>
	poison(): void
	close(): Promise<void>
}
export function createDemoSignerSerialization(options: { leasePath: string; quarantinePath: string; assertCurrent(): void; assertReady?(): void; maximumQueue?: number }): DemoSignerSerialization {
	const maximum = options.maximumQueue ?? 16
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 16) throw new Error('SIGNER_QUEUE_BOUND')
	for (const path of [options.leasePath, options.quarantinePath]) {
		try { if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('SIGNER_LEASE_UNSAFE') }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
	}
	try { lstatSync(options.quarantinePath); throw new Error('DEMO_SIGNER_QUARANTINED: persistent uncertainty marker') }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
	const fd = openSync(options.leasePath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
	if (libc.symbols.flock(fd, 2 | 4) !== 0) { closeSync(fd); throw new Error('DEMO_SIGNER_QUARANTINED: another signer process owns stores') }
	let closing = false, poisoned = false, queued = 0, tail = Promise.resolve()
	const poison = () => {
			poisoned = true
			try {
				const marker = openSync(options.quarantinePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
				try { writeSync(marker, 'SIGNER_LOCAL_UNCERTAINTY_V2\n'); fsyncSync(marker) } finally { closeSync(marker) }
				const directory = openSync(dirname(options.quarantinePath), constants.O_RDONLY | constants.O_DIRECTORY)
				try { fsyncSync(directory) } finally { closeSync(directory) }
			} catch { /* In-memory fence remains; pending/anchor mismatches also remain. Never rebase. */ }
	}
	const check = (mode?: 'read-only') => {
		if (closing || poisoned) throw new Error('DEMO_SIGNER_QUARANTINED: mutation gate is fenced')
		try { options.assertCurrent() } catch { if (mode !== 'read-only') poison(); throw new Error('DEMO_SIGNER_QUARANTINED: safety observation failed') }
	}
	async function enqueue<T>(signal: AbortSignal, operation: () => Promise<T>, readOnly: boolean): Promise<T> {
			if (closing || !readOnly && poisoned || signal.aborted || queued >= maximum) throw new Error('DEMO_SIGNER_QUEUE_UNAVAILABLE')
			queued++; const previous = tail; let release!: () => void
			tail = new Promise<void>((resolve) => { release = resolve })
			let acquired = false
			let timer: ReturnType<typeof setTimeout> | undefined
			let onAbort!: () => void
			const canceled = new Promise<never>((_, reject) => {
				onAbort = () => reject(new Error('DEMO_SIGNER_QUEUE_UNAVAILABLE'))
				signal.addEventListener('abort', onAbort, { once: true })
				timer = setTimeout(onAbort, 5000)
			})
			try {
				await Promise.race([previous.then(() => { acquired = true }), canceled])
				if (signal.aborted) throw new Error('DEMO_SIGNER_QUEUE_UNAVAILABLE')
				if (closing) throw new Error('DEMO_SIGNER_QUARANTINED: mutation gate is fenced')
				if (!readOnly) {
					check()
					try { options.assertReady?.() } catch { poison(); throw new Error('DEMO_SIGNER_QUARANTINED: journal readiness failed') }
				}
				return await operation()
			} finally {
				clearTimeout(timer); signal.removeEventListener('abort', onAbort)
				if (acquired) { queued--; release() }
				else { // Return promptly, but keep this canceled slot fenced/budgeted
					// until its predecessor drains. Never let a successor overtake it.
					void previous.then(() => { queued--; release() })
				}
			}
	}
	return {
		check, poison,
		run: <T>(signal: AbortSignal, operation: () => Promise<T>) => enqueue(signal, operation, false),
		observe: <T>(signal: AbortSignal, operation: () => Promise<T>) => enqueue(signal, operation, true),
		async close() { if (closing) return; closing = true; await tail; libc.symbols.flock(fd, 8); closeSync(fd) },
	}
}
