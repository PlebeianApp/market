#!/usr/bin/env bun
/**
 * Dev seed orchestrator.
 *
 * Spawns the ContextVM auction server in the background, waits for it
 * to log "Server is running", then runs the seed script (which uses the
 * CVM client to request real derivation paths for every seeded bid),
 * then leaves the server running and starts the bun web dev server.
 *
 * Replaces the previous `bun run startup && bun run seed && bun --hot src/index.tsx`
 * chain — the seed now needs the CVM server alive before it can publish
 * auctions whose `path_issuer` resolves to anything reachable.
 *
 * Failure modes:
 *   - CVM server never logs "ready" → `dev:seed` aborts after a 30s
 *     timeout and leaves no orphan processes.
 *   - Seed step fails → both the seed and the CVM server are killed
 *     (we don't want a half-seeded relay + a dangling server eating CPU).
 *   - Bun web server step fails → CVM server is killed.
 */

import { spawn, type Subprocess } from 'bun'

const CVM_READY_TIMEOUT_MS = 30_000
const CVM_READY_MARKER = 'Server is running and listening for requests on Nostr'

async function waitForCvmReady(server: Subprocess, label: string): Promise<void> {
	const stream = server.stdout as ReadableStream<Uint8Array> | null
	if (!stream || typeof stream === 'number') {
		throw new Error(`${label} has no piped stdout — cannot wait for ready signal`)
	}
	const reader = stream.getReader()
	const decoder = new TextDecoder()
	const start = Date.now()
	let buf = ''
	while (Date.now() - start < CVM_READY_TIMEOUT_MS) {
		const { done, value } = await reader.read()
		if (done) throw new Error(`${label} exited before ready signal`)
		const chunk = decoder.decode(value)
		// Forward server output so the dev sees the same logs they would
		// in a dedicated terminal.
		process.stdout.write(chunk)
		buf += chunk
		if (buf.includes(CVM_READY_MARKER)) {
			reader.releaseLock()
			// Drain remaining stdout in the background to keep the pipe alive
			// without blocking us. We don't capture from here onward — Bun
			// pipes the rest through normally once we yield.
			void (async () => {
				const tail = (server.stdout as ReadableStream<Uint8Array>).getReader()
				while (true) {
					const next = await tail.read()
					if (next.done) break
					process.stdout.write(decoder.decode(next.value))
				}
			})()
			return
		}
	}
	reader.releaseLock()
	throw new Error(`Timed out waiting for ${label} ready signal after ${CVM_READY_TIMEOUT_MS}ms`)
}

async function run(label: string, cmd: string[], opts: { detach?: boolean } = {}): Promise<Subprocess> {
	const proc = spawn({
		cmd,
		stdio: ['inherit', opts.detach ? 'pipe' : 'inherit', 'inherit'],
		env: process.env,
	})
	if (!opts.detach) {
		const exit = await proc.exited
		if (exit !== 0) throw new Error(`${label} exited with code ${exit}`)
	}
	return proc
}

async function main() {
	console.log('=== dev:seed orchestrator ===')

	console.log('Starting ContextVM auction server in background...')
	const cvmServer = spawn({
		cmd: ['bun', 'run', 'contextvm/server.ts'],
		stdio: ['inherit', 'pipe', 'inherit'],
		env: process.env,
	})

	const cleanup = () => {
		try {
			cvmServer.kill()
		} catch {
			// already exited
		}
	}
	process.on('SIGINT', () => {
		cleanup()
		process.exit(130)
	})
	process.on('SIGTERM', () => {
		cleanup()
		process.exit(143)
	})

	try {
		await waitForCvmReady(cvmServer, 'cvm server')
		console.log('✓ CVM server is ready — proceeding with seed.\n')

		console.log('Running app startup (kind 31990 settings)...')
		await run('startup', ['bun', 'run', 'scripts/startup.ts'])

		console.log('\nRunning seed (this calls request_path on the CVM server for every bid)...')
		await run('seed', ['bun', 'run', 'scripts/seed.ts'])

		console.log('\n=== seed complete — handing off to bun dev (CVM server stays running) ===')
		// `bun --hot` runs in the foreground; keeping the CVM server alive
		// happens implicitly because we never killed it.
		const webServer = spawn({
			cmd: ['bun', '--hot', 'src/index.tsx', '--host', '0.0.0.0'],
			stdio: ['inherit', 'inherit', 'inherit'],
			env: process.env,
		})
		const exit = await webServer.exited
		cleanup()
		process.exit(exit)
	} catch (error) {
		console.error('[dev:seed] aborting:', error instanceof Error ? error.message : error)
		cleanup()
		process.exit(1)
	}
}

void main()
