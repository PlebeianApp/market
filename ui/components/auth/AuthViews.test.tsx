import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BunkerConnectView } from './BunkerConnectView'
import { MigratePrivateKeyDialogView } from './AuthKeyDialogs'
import { NostrConnectQRView } from './NostrConnectQRView'
import { PrivateKeyLoginView, type PrivateKeyLoginViewProps } from './PrivateKeyLoginView'

const noop = () => {}

const keyLogin: PrivateKeyLoginViewProps = {
	step: 'enter-key',
	isLoading: false,
	storedPubkey: null,
	privateKey: '',
	onPrivateKeyChange: noop,
	keyError: null,
	password: '',
	onPasswordChange: noop,
	confirmPassword: '',
	onConfirmPasswordChange: noop,
	passwordError: '',
	isGeneratedKey: false,
	onGenerateKey: noop,
	onContinue: noop,
	onEncryptAndStore: noop,
	onStoredKeyLogin: noop,
	onClearStoredKey: noop,
}

describe('PrivateKeyLoginView', () => {
	test('stored-key step shows the truncated pubkey', () => {
		const markup = renderToStaticMarkup(
			createElement(PrivateKeyLoginView, { ...keyLogin, step: 'stored-key', storedPubkey: 'abcdef0123456789' }),
		)
		expect(markup).toContain('Pubkey: abcdef01...')
		expect(markup).toContain('data-testid="clear-stored-key-button"')
	})

	test('generated keys show the save warning', () => {
		const markup = renderToStaticMarkup(createElement(PrivateKeyLoginView, { ...keyLogin, privateKey: 'nsec1x', isGeneratedKey: true }))
		expect(markup).toContain('cannot be recovered')
		expect(markup).toContain('data-testid="acknowledge-warning-checkbox"')
	})

	test('key errors render under the input', () => {
		expect(renderToStaticMarkup(createElement(PrivateKeyLoginView, { ...keyLogin, keyError: 'Invalid nsec format' }))).toContain(
			'Invalid nsec format',
		)
	})
})

describe('BunkerConnectView', () => {
	test('renders a host-vetted approval link', () => {
		const markup = renderToStaticMarkup(
			createElement(BunkerConnectView, {
				bunkerUrl: 'bunker://x',
				onBunkerUrlChange: noop,
				error: null,
				authUrl: 'https://signer.example/approve',
				isConnecting: false,
				onConnect: noop,
				onScanned: noop,
			}),
		)
		expect(markup).toContain('href="https://signer.example/approve"')
	})
})

describe('NostrConnectQRView', () => {
	test('shows the connection URI once ready', () => {
		const markup = renderToStaticMarkup(
			createElement(NostrConnectQRView, {
				relays: [{ value: 'wss://relay', label: 'Relay' }],
				selectedRelay: 'wss://relay',
				onRelayChange: noop,
				customRelay: '',
				onCustomRelayChange: noop,
				isGenerating: false,
				isConnected: false,
				hasError: false,
				isListening: true,
				connectionUrl: 'nostrconnect://pk?relay=wss%3A%2F%2Frelay',
				onCopyConnectionUrl: noop,
			}),
		)
		expect(markup).toContain('Waiting for approval...')
		expect(markup).toContain('nostrconnect://pk')
	})
})

describe('MigratePrivateKeyDialogView', () => {
	test('renders nothing when migration is not needed', () => {
		expect(
			renderToStaticMarkup(createElement(MigratePrivateKeyDialogView, { open: false, minPasswordLength: 8, onEncrypt: async () => {} })),
		).toBe('')
	})
})
