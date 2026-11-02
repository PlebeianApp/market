#!/usr/bin/env bun

const MAX_RESPONSE = 4 * 1024 * 1024

function fail(): never { throw new Error('Friday Comet probe rejected') }

export async function runDemoFridayCometProbe(argv = process.argv.slice(2),
	fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch): Promise<string> {
	let url: URL
	if (argv.length === 1 && argv[0] === 'status') url = new URL('http://127.0.0.1:27657/status')
	else if (argv.length === 1 && argv[0] === 'state') {
		url = new URL('http://127.0.0.1:27657/abci_query'); url.searchParams.set('path', '"/state"')
	} else if (argv.length === 2 && (argv[0] === 'commit' || argv[0] === 'block')
		&& /^[1-9][0-9]{0,15}$/.test(argv[1]!)) {
		url = new URL(`http://127.0.0.1:27657/${argv[0]}`); url.searchParams.set('height', argv[1]!)
	} else fail()
	const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
	const text = await response.text()
	if (!response.ok || text.length < 2 || text.length > MAX_RESPONSE
		|| !String(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) fail()
	try { JSON.parse(text) } catch { return fail() }
	return text.endsWith('\n') ? text : `${text}\n`
}

if (import.meta.main) {
	try { process.stdout.write(await runDemoFridayCometProbe()) }
	catch { process.stderr.write('Friday Comet probe rejected\n'); process.exitCode = 1 }
}
