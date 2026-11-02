#!/usr/bin/env bun
/**
 * Stdin/stdout adapter for the public/ciphertext-only DKG relay.
 *
 * It accepts no filesystem path or URL. Input is bounded and is never logged;
 * failures emit a fixed diagnostic rather than echoing request material.
 */
import { executeDemoFridayDkgRelayRequestV1 } from './demo-friday-per-validator-dkg-relay'

const MAX_REQUEST_BYTES = 4 * 1024 * 1024

async function readBoundedRequest(): Promise<unknown> {
	const chunks: Uint8Array[] = []
	let total = 0
	const reader = Bun.stdin.stream().getReader()
	for (;;) {
		const { done, value: chunk } = await reader.read()
		if (done) break
		total += chunk.byteLength
		if (total > MAX_REQUEST_BYTES) throw new Error('request exceeds relay limit')
		chunks.push(chunk)
	}
	if (total === 0) throw new Error('request is empty')
	const joined = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		joined.set(chunk, offset)
		offset += chunk.byteLength
	}
	return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)) as unknown
}

export async function runDemoFridayDkgRelayCli(): Promise<void> {
	const result = executeDemoFridayDkgRelayRequestV1(await readBoundedRequest())
	process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.main) {
	try {
		await runDemoFridayDkgRelayCli()
	} catch {
		process.stderr.write('Friday DKG relay request rejected\n')
		process.exitCode = 1
	}
}
