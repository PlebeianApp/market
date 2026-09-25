const path = require('node:path')

const releaseRoot = path.resolve(__dirname, '..', '..')
const logsRoot = '/home/deployer/logs'

function selected(names) {
	return Object.fromEntries(names.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])))
}

const sharedAppEnv = selected([
	'APP_STAGE',
	'NODE_ENV',
	'APP_RELAY_URL',
	'APP_PRIVATE_KEY',
	'CVM_SERVER_KEY',
	'NIP46_RELAY_URL',
	'APP_DEPLOYMENT_ENVIRONMENT',
	'APP_MARKET_GIT_SHA',
	'APP_MARKET_GIT_TREE',
	'APP_COCO_PACKAGE_IDENTITY',
	'APP_COCO_CORE_GIT_SHA',
	'APP_COCO_CORE_ARCHIVE_SHA256',
	'APP_COCO_CORE_SHA256',
	'APP_COCO_INDEXEDDB_ARCHIVE_SHA256',
	'APP_COCO_INDEXEDDB_SHA256',
	'APP_CASHU_TS_VERSION',
	'APP_CASHU_TS_SHA256',
	'APP_FAKE_MINT_VERSION',
	'APP_BUN_VERSION',
	'APP_MONETARY_MODE',
	'APP_MINT_MODE',
	'APP_REAL_FUNDS_ENABLED',
	'APP_FRESH_AUCTIONSDEV_TEST_SHA256',
	'APP_FRESH_AUCTIONSDEV_TEST_VERDICT',
	'APP_FRESH_NAMESPACE_COMMITMENT',
	'APP_FRESH_REPORT_COMMITMENT',
	'APP_FRESH_ENVELOPE_COMMITMENT',
	'APP_FRESH_EVIDENCE_ENVIRONMENT',
	'APP_COCO_AUCTIONSDEV_SMOKE_SHA256',
	'APP_COCO_AUCTIONSDEV_SMOKE_STATUS',
	'APP_COCO_AUCTIONSDEV_SMOKE_ENVELOPE_COMMITMENT',
	'APP_COCO_AUCTIONSDEV_SMOKE_SCHEMA_VERSION',
	'APP_COCO_AUCTIONSDEV_SMOKE_COLD_START',
	'APP_COCO_AUCTIONSDEV_SMOKE_CHECKS_PASSED',
])

const contextVmEnv = selected(['APP_STAGE', 'NODE_ENV', 'APP_RELAY_URL', 'CVM_SERVER_KEY'])

const fakeMintEnv = selected(['CASHU_MINT_DIR', 'CASHU_MINT_HOST', 'CASHU_MINT_PORT', 'CASHU_MINT_PUBLIC_URL', 'CDK_MINTD_MNEMONIC'])

if (fakeMintEnv.CASHU_MINT_HOST && fakeMintEnv.CASHU_MINT_HOST !== '127.0.0.1') throw new Error('Fake mint must bind to loopback')
if (fakeMintEnv.CASHU_MINT_PORT && fakeMintEnv.CASHU_MINT_PORT !== '3338') throw new Error('Fake mint must use port 3338')
if (sharedAppEnv.APP_REAL_FUNDS_ENABLED && sharedAppEnv.APP_REAL_FUNDS_ENABLED !== 'false') {
	throw new Error('Real funds must remain disabled on AuctionsDev')
}
if (sharedAppEnv.APP_MINT_MODE && sharedAppEnv.APP_MINT_MODE !== 'fake') throw new Error('AuctionsDev requires fake mint mode')
if (sharedAppEnv.APP_CASHU_TS_VERSION && sharedAppEnv.APP_CASHU_TS_VERSION !== '5.0.0-rc.4') {
	throw new Error('AuctionsDev requires @cashu/cashu-ts@5.0.0-rc.4')
}

module.exports = {
	apps: [
		{
			name: 'market-coco-fake-mint-auctionsdev',
			script: path.join(releaseRoot, 'runtime/cdk-mintd'),
			interpreter: 'none',
			args: ['--work-dir', fakeMintEnv.CASHU_MINT_DIR ?? '/invalid/missing-cashu-mint-dir'],
			cwd: releaseRoot,
			env: {
				...fakeMintEnv,
				CDK_MINTD_DATABASE: 'sqlite',
				CDK_MINTD_LN_BACKEND: 'fakewallet',
				CDK_MINTD_INPUT_FEE_PPK: '0',
				CDK_MINTD_LISTEN_HOST: fakeMintEnv.CASHU_MINT_HOST,
				CDK_MINTD_LISTEN_PORT: fakeMintEnv.CASHU_MINT_PORT,
				CDK_MINTD_URL: fakeMintEnv.CASHU_MINT_PUBLIC_URL,
				CDK_MINTD_FAKE_WALLET_SUPPORTED_UNITS: 'sat',
				CDK_MINTD_FAKE_WALLET_FEE_PERCENT: '0',
				CDK_MINTD_FAKE_WALLET_RESERVE_FEE_MIN: '0',
				CDK_MINTD_FAKE_WALLET_MIN_DELAY: '0',
				CDK_MINTD_FAKE_WALLET_MAX_DELAY: '0',
			},
			error_file: `${logsRoot}/market-coco-fake-mint-auctionsdev-error.log`,
			out_file: `${logsRoot}/market-coco-fake-mint-auctionsdev-out.log`,
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			merge_logs: true,
			autorestart: true,
			max_restarts: 10,
			min_uptime: '10s',
			restart_delay: 5000,
			kill_timeout: 5000,
		},
		{
			name: 'market-auctionsdev',
			script: path.join(releaseRoot, 'src/index.tsx'),
			interpreter: path.join(releaseRoot, 'runtime/bun'),
			cwd: releaseRoot,
			instances: 1,
			exec_mode: 'fork',
			env: { ...sharedAppEnv, ...selected(['PORT']) },
			error_file: `${logsRoot}/market-auctionsdev-error.log`,
			out_file: `${logsRoot}/market-auctionsdev-out.log`,
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			merge_logs: true,
			autorestart: true,
			max_restarts: 10,
			min_uptime: '10s',
			restart_delay: 5000,
			max_memory_restart: '500M',
			kill_timeout: 5000,
		},
		{
			name: 'market-contextvm-auctionsdev',
			script: path.join(releaseRoot, 'contextvm/server.ts'),
			interpreter: path.join(releaseRoot, 'runtime/bun'),
			cwd: releaseRoot,
			instances: 1,
			exec_mode: 'fork',
			env: contextVmEnv,
			error_file: `${logsRoot}/market-contextvm-auctionsdev-error.log`,
			out_file: `${logsRoot}/market-contextvm-auctionsdev-out.log`,
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			merge_logs: true,
			autorestart: true,
			max_restarts: 10,
			min_uptime: '10s',
			restart_delay: 5000,
			max_memory_restart: '500M',
			kill_timeout: 5000,
		},
	],
}
