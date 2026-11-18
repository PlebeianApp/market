interface RelayConnection {
	connect(): Promise<void>
	pool: {
		connectedRelays(): readonly unknown[]
		on(event: 'relay:connect', listener: () => void): unknown
		off(event: 'relay:connect', listener: () => void): unknown
	}
}

export async function connectToFirstRelay(connection: RelayConnection, timeoutMs: number): Promise<boolean> {
	if (connection.pool.connectedRelays().length > 0) return true

	let timer: ReturnType<typeof setTimeout> | undefined
	let onConnect = () => {}
	const firstConnected = new Promise<void>((resolve) => {
		onConnect = () => {
			if (connection.pool.connectedRelays().length > 0) resolve()
		}
		connection.pool.on('relay:connect', onConnect)
		onConnect()
	})

	try {
		await Promise.race([
			firstConnected,
			connection.connect(),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, timeoutMs)
			}),
		])
		return connection.pool.connectedRelays().length > 0
	} finally {
		if (timer) clearTimeout(timer)
		connection.pool.off('relay:connect', onConnect)
	}
}
