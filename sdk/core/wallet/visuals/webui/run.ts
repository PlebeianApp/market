#!/usr/bin/env bun
/**
 * run.ts — the run program for the wallet page.
 *
 * Declared in wallet.md's `webui:` block as `run: [bun, run, visuals/webui/run.ts]`.
 * It serves the self-contained page in this directory over HTTP on `--port` (default 4329, the
 * port the run reserved for the payment surface) and `--host`.
 *
 * It is a MODEL's server and nothing else. The page it serves is the payment state machine laid out
 * to be driven; the page reaches no relay, mint or wallet, and neither does this program. There is no
 * `/api` route and no state read: every rule the page shows is transcribed from the modules'
 * semantics (the funds contract and this aggregator), and the page re-implements the aggregator's own
 * derivation in the browser. Nothing here opens a socket beyond the loopback listener below.
 *
 * The semantics the page renders are the aggregator's (`../../wallet.md`): the set record that
 * stores a witness per leg rather than a verdict and derives the state from what is proven, excluding
 * any untrusted leg; the conservation band summed for the aggregate with a signed residual and two
 * directions; the rule-reached terminals; and the acceptance gate that refuses a malformed
 * registration fail-closed. The aggregator itself cites only the funds contract and names no rail, so
 * no wrapper, relay, mint or wallet is referenced here either.
 *
 *   bun run visuals/webui/run.ts [--port <n>] [--host <h>]
 */
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PORT = 4329
const DEFAULT_HOST = '127.0.0.1'

function flag(argv: string[], name: string, def: string): string {
	const i = argv.indexOf(name)
	return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}

function help(): void {
	console.log(`wallet webui — the payment state machine, laid out to be driven, served locally on port ${DEFAULT_PORT}

  bun run visuals/webui/run.ts [--port <n>] [--host <h>]

  --port <n>    the port to bind (default ${DEFAULT_PORT}, the reserved payment-surface port)
  --host <h>    the interface to bind (default ${DEFAULT_HOST})

Serves index.html from ${HERE} — a single self-contained page, no remote asset, no network.
The page is a MODEL of the wallet's semantics: the port's three operations, the rung
vocabulary, the purchase and refund machines, the set-record derivation, the conservation band
and the acceptance gate, with a console to drive the derived set state. No live node, mint or
wallet is involved; this program reads no state and calls nothing out.
Skill:  ${resolve(HERE, 'SKILL.md')}`)
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2)
	if (argv.includes('--help') || argv.includes('-h')) {
		help()
		process.exit(0)
	}

	const port = Number(flag(argv, '--port', String(DEFAULT_PORT)))
	const host = flag(argv, '--host', DEFAULT_HOST)

	const server = Bun.serve({
		port,
		hostname: host,
		fetch(req) {
			let path: string
			try {
				path = decodeURIComponent(new URL(req.url).pathname)
			} catch {
				return new Response('bad path', { status: 400 })
			}
			const rel = path === '/' ? 'index.html' : path.replace(/^\//, '')
			const target = resolve(HERE, rel)
			if (relative(HERE, target).startsWith('..') || !existsSync(target)) {
				return new Response('not found', { status: 404 })
			}
			return new Response(Bun.file(target), {
				headers: { 'cache-control': 'no-store' },
			})
		},
	})

	console.log(`wallet webui — http://${host}:${server.port}/  (a model; no live node, mint or wallet)`)
}

if (import.meta.main) {
	await main()
}
