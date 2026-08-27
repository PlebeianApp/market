import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { WalletStateStore } from '../tools/wallet-state-store'
import {
	walletStateSyncInputSchema,
	walletStateSyncOutputSchema,
	walletStateRequestInputSchema,
	walletStateRequestOutputSchema,
} from '../schemas'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const PUBKEY = 'a'.repeat(64)
const ENC_STATE = 'nip44:ciphertext:abc123'

describe('wallet-state server integration', () => {
	let store: WalletStateStore
	let dbPath: string

	beforeEach(() => {
		const dir = mkdtempSync('wallet-state-server-test-')
		dbPath = join(dir, 'test-wallet-state.sqlite')
		store = new WalletStateStore(dbPath)
	})

	afterEach(() => {
		store.close()
		const dir = dbPath.replace('/test-wallet-state.sqlite', '')
		rmSync(dir, { recursive: true, force: true })
	})

	async function createServerAndClient() {
		const mcpServer = new McpServer({
			name: 'test-wallet-state-server',
			version: '1.0.0',
		})

		mcpServer.registerTool(
			'wallet_state_sync',
			{
				title: 'Sync Wallet State',
				description: 'Store an encrypted wallet state snapshot.',
				inputSchema: walletStateSyncInputSchema,
				outputSchema: walletStateSyncOutputSchema,
			},
			async ({ pubkey, encryptedState, sequence, version }) => {
				const newVersion = store.sync(pubkey, encryptedState, sequence, version)
				if (newVersion === null) {
					return {
						content: [],
						structuredContent: { error: 'Stale write rejected' },
						isError: true,
					}
				}
				return {
					content: [],
					structuredContent: {
						pubkey,
						version: newVersion,
						storedAt: Date.now(),
						accepted: true,
					},
				}
			},
		)

		mcpServer.registerTool(
			'wallet_state_request',
			{
				title: 'Request Wallet State',
				description: 'Return the latest stored wallet state snapshot.',
				inputSchema: walletStateRequestInputSchema,
				outputSchema: walletStateRequestOutputSchema,
			},
			async ({ pubkey }) => {
				const record = store.get(pubkey)
				if (!record) {
					return {
						content: [],
						structuredContent: {
							pubkey,
							found: false,
							encryptedState: null,
							version: null,
							sequence: null,
							storedAt: null,
						},
					}
				}
				return {
					content: [],
					structuredContent: {
						pubkey,
						found: true,
						encryptedState: record.encryptedState,
						version: record.version,
						sequence: record.sequence,
						storedAt: record.storedAt,
					},
				}
			},
		)

		const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
		await mcpServer.connect(serverTransport)

		const client = new Client({ name: 'test-client', version: '1.0.0' })
		await client.connect(clientTransport)

		return {
			client,
			close: async () => {
				await client.close()
			},
		}
	}

	test('wallet_state_sync stores a snapshot and returns version 1', async () => {
		const { client, close } = await createServerAndClient()
		try {
			const result = await client.callTool({
				name: 'wallet_state_sync',
				arguments: { pubkey: PUBKEY, encryptedState: ENC_STATE, sequence: 0 },
			})
			const structured = (result as any)?.structuredContent
			expect(structured.error).toBeUndefined()
			expect(structured.accepted).toBe(true)
			expect(structured.pubkey).toBe(PUBKEY)
			expect(structured.version).toBe(1)
			expect(structured.storedAt).toBeGreaterThan(0)
		} finally {
			await close()
		}
	})

	test('wallet_state_sync bumps version on subsequent writes', async () => {
		const { client, close } = await createServerAndClient()
		try {
			await client.callTool({
				name: 'wallet_state_sync',
				arguments: { pubkey: PUBKEY, encryptedState: ENC_STATE, sequence: 0 },
			})
			const result = await client.callTool({
				name: 'wallet_state_sync',
				arguments: { pubkey: PUBKEY, encryptedState: 'nip44:ciphertext:second', sequence: 1 },
			})
			expect((result as any).structuredContent.version).toBe(2)
		} finally {
			await close()
		}
	})

	test('wallet_state_sync rejects stale write with mismatched version', async () => {
		const { client, close } = await createServerAndClient()
		try {
			await client.callTool({
				name: 'wallet_state_sync',
				arguments: { pubkey: PUBKEY, encryptedState: ENC_STATE, sequence: 0 },
			})
			const result = await client.callTool({
				name: 'wallet_state_sync',
				arguments: { pubkey: PUBKEY, encryptedState: 'nip44:ciphertext:stale', sequence: 1, version: 99 },
			})
			const structured = (result as any)?.structuredContent
			expect(structured.error).toBeDefined()
			expect((result as any).isError).toBe(true)
		} finally {
			await close()
		}
	})

	test('wallet_state_request returns not-found for unknown pubkey', async () => {
		const { client, close } = await createServerAndClient()
		try {
			const result = await client.callTool({
				name: 'wallet_state_request',
				arguments: { pubkey: 'b'.repeat(64) },
			})
			const structured = (result as any)?.structuredContent
			expect(structured.found).toBe(false)
			expect(structured.encryptedState).toBeNull()
			expect(structured.version).toBeNull()
		} finally {
			await close()
		}
	})

	test('wallet_state_request returns stored snapshot after sync', async () => {
		const { client, close } = await createServerAndClient()
		try {
			await client.callTool({
				name: 'wallet_state_sync',
				arguments: { pubkey: PUBKEY, encryptedState: ENC_STATE, sequence: 0 },
			})
			const result = await client.callTool({
				name: 'wallet_state_request',
				arguments: { pubkey: PUBKEY },
			})
			const structured = (result as any)?.structuredContent
			expect(structured.found).toBe(true)
			expect(structured.encryptedState).toBe(ENC_STATE)
			expect(structured.version).toBe(1)
			expect(structured.sequence).toBe(0)
			expect(structured.storedAt).toBeGreaterThan(0)
		} finally {
			await close()
		}
	})

	test('wallet_state_request returns latest state after multiple syncs', async () => {
		const { client, close } = await createServerAndClient()
		try {
			await client.callTool({
				name: 'wallet_state_sync',
				arguments: { pubkey: PUBKEY, encryptedState: ENC_STATE, sequence: 0 },
			})
			await client.callTool({
				name: 'wallet_state_sync',
				arguments: { pubkey: PUBKEY, encryptedState: 'nip44:ciphertext:latest', sequence: 5 },
			})
			const result = await client.callTool({
				name: 'wallet_state_request',
				arguments: { pubkey: PUBKEY },
			})
			const structured = (result as any)?.structuredContent
			expect(structured.encryptedState).toBe('nip44:ciphertext:latest')
			expect(structured.version).toBe(2)
			expect(structured.sequence).toBe(5)
		} finally {
			await close()
		}
	})

	test('lists wallet tools correctly', async () => {
		const { client, close } = await createServerAndClient()
		try {
			const tools = await client.listTools()
			const toolNames = tools.tools.map((t: any) => t.name)
			expect(toolNames).toContain('wallet_state_sync')
			expect(toolNames).toContain('wallet_state_request')
		} finally {
			await close()
		}
	})
})
