// PM2 Ecosystem Configuration for Plebeian Market
//
// ⚠️  THIS FILE IS FOR LOCAL DOCKER SIMULATION ONLY
//
// For real deployments (staging/production), the ecosystem.config.cjs
// is generated dynamically by deploy-simple/deploy.sh with stage-specific
// paths and settings.
//
// See: deploy-simple/README.md

module.exports = {
	apps: [
		{
			name: 'market-staging',
			script: 'bun',
			args: 'src/index.tsx',
			cwd: '/home/deployer/market',
			instances: 1,
			exec_mode: 'fork',

			// Environment - use 'staging' to enable Bun's on-the-fly bundling
			// The server uses development: process.env.NODE_ENV !== 'production'
			env: {
				NODE_ENV: 'staging',
				PORT: 3000,
			},
			env_file: '.env',

			// Logging
			error_file: '/home/deployer/logs/market-staging-error.log',
			out_file: '/home/deployer/logs/market-staging-out.log',
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			merge_logs: true,

			// Process management
			autorestart: true,
			max_restarts: 10,
			min_uptime: '10s',
			restart_delay: 5000,

			// Watching (disabled in production)
			watch: false,
			ignore_watch: ['node_modules', 'logs', '.git'],

			// Resource limits
			max_memory_restart: '500M',

			// Graceful shutdown
			kill_timeout: 5000,
			wait_ready: true,
			listen_timeout: 10000,
		},

		// Production configuration (uncomment for production server)
		// {
		//   name: 'market-production',
		//   script: 'bun',
		//   args: 'src/index.tsx',
		//   cwd: '/opt/market',
		//   instances: 1,
		//   exec_mode: 'fork',
		//
		//   env: {
		//     NODE_ENV: 'production',
		//     PORT: 3001,
		//   },
		//   env_file: '.env',
		//
		//   error_file: '/var/log/pm2/market-production-error.log',
		//   out_file: '/var/log/pm2/market-production-out.log',
		//   log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
		//   merge_logs: true,
		//
		//   autorestart: true,
		//   max_restarts: 10,
		//   min_uptime: '10s',
		//   restart_delay: 5000,
		//
		//   watch: false,
		//   max_memory_restart: '1G',
		//
		//   kill_timeout: 5000,
		//   wait_ready: true,
		//   listen_timeout: 10000,
		// },
	],
}
