type NavItem = {
	title: string
	path: string
	adminOnly?: boolean // New optional property to mark admin-only items
}

type NavSection = {
	title: string
	items: NavItem[]
	adminOnly?: boolean // New optional property to mark admin-only sections
}

export const dashboardNavigation: NavSection[] = [
	{
		title: 'SALES',
		items: [
			{
				title: '💰 Sales',
				path: '/dashboard/sales/sales',
			},
			{
				title: '✉️ Messages',
				path: '/dashboard/sales/messages',
			},
			{
				title: '♻️ Circular Economy',
				path: '/dashboard/sales/circular-economy',
			},
		],
	},
	{
		title: 'PRODUCTS',
		items: [
			{
				title: '📦 Products',
				path: '/dashboard/products/products',
			},
			{
				title: '🔨 My Auctions',
				path: '/dashboard/products/auctions',
			},
			{
				title: '🗂️ Collections',
				path: '/dashboard/products/collections',
			},
			{
				title: '🔄 Migration Tool',
				path: '/dashboard/products/migration-tool',
			},
			{
				title: '📫 Shipping Options',
				path: '/dashboard/products/shipping-options',
			},
		],
	},
	{
		title: 'ACCOUNT',
		items: [
			{
				title: '✨ Vanity URL',
				path: '/dashboard/account/vanity-url',
			},
			{
				title: '📧 Nostr Address',
				path: '/dashboard/account/nostr-address',
			},
			{
				title: '👤 Profile',
				path: '/dashboard/account/profile',
			},
			{
				title: '💳 Make Payments',
				path: '/dashboard/account/making-payments',
			},
			{
				title: '💸 Receive Payments',
				path: '/dashboard/account/receiving-payments',
			},
			{
				title: '🛍️ Your Purchases',
				path: '/dashboard/account/your-purchases',
			},
			{
				title: '🌐 Network',
				path: '/dashboard/account/network',
			},
			{
				title: '⚙️ Preferences',
				path: '/dashboard/account/preferences',
			},
		],
	},
	{
		title: 'APP SETTINGS',
		adminOnly: true, // Only show this section to admins
		items: [
			{
				title: '⚙️ App Miscellaneous',
				path: '/dashboard/app-settings/app-miscelleneous',
				adminOnly: true,
			},
			{
				title: '👥 Team',
				path: '/dashboard/app-settings/team',
				adminOnly: true,
			},
			{
				title: '🚫 Blacklists',
				path: '/dashboard/app-settings/blacklists',
				adminOnly: true,
			},
			{
				title: '⭐ Featured Items',
				path: '/dashboard/app-settings/featured-items',
				adminOnly: true,
			},
		],
	},
	{
		title: 'INFO',
		items: [
			{
				title: 'ℹ️ About',
				path: '/dashboard/about',
			},
		],
	},
]
