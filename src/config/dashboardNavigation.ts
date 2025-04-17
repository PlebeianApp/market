type NavItem = {
	title: string
	path: string
}

type NavSection = {
	title: string
	items: NavItem[]
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
				title: '🗂️ Collections',
				path: '/dashboard/products/collections',
			},
			{
				title: '💸 Receiving Payments',
				path: '/dashboard/products/receiving-payments',
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
				title: '👤 Profile',
				path: '/dashboard/account/profile',
			},
			{
				title: '💳 Making Payments',
				path: '/dashboard/account/making-payments',
			},
			{
				title: '🛍️ Your Purchases',
				path: '/dashboard/account/your-purchases',
			},
			{
				title: '🌐 Network',
				path: '/dashboard/account/network',
			},
		],
	},
]
