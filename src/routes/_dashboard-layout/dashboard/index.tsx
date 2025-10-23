import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { authStore } from '@/lib/stores/auth'
import { useConversationsList } from '@/queries/messages'
import { useOrders } from '@/queries/orders'
import { useProductsByPubkey } from '@/queries/products'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'

export const Route = createFileRoute('/_dashboard-layout/dashboard/')({
	component: DashboardInnerComponent,
})

function DashboardInnerComponent() {
	useDashboardTitle('Dashboard')

	const { user } = useStore(authStore)
	const userPubkey = user?.pubkey || ''

	const { data: myProducts, isLoading: isLoadingProducts } = useProductsByPubkey(userPubkey, true)
	const { data: orders, isLoading: isLoadingOrders } = useOrders()
	const { data: conversations, isLoading: isLoadingMessages } = useConversationsList()

	// Calculate stats
	const activeListings =
		myProducts?.filter((p: NDKEvent) => {
			const visibility = p.tags.find((t: string[]) => t[0] === 'visibility')?.[1]
			return visibility !== 'hidden'
		}).length || 0

	const totalListings = myProducts?.length || 0

	// Buyer = author of order (sent the order)
	// Seller = recipient of order (tagged with #p)
	const buyerOrders =
		orders?.filter((o) => {
			return o.order.pubkey === userPubkey
		}) || []

	const sellerOrders =
		orders?.filter((o) => {
			const pTag = o.order.tags.find((t) => t[0] === 'p')
			return pTag?.[1] === userPubkey
		}) || []

	const unreadMessages = conversations?.length || 0

	const recentOrders = orders?.slice(0, 3) || []

	const isLoading = isLoadingProducts || isLoadingOrders || isLoadingMessages

	return (
		<div className="space-y-6">
			{/* Welcome Section */}
			<div>
				<h2 className="text-2xl font-bold mb-2">Welcome back!</h2>
				<p className="text-muted-foreground">Here's what's happening with your marketplace</p>
			</div>

			{/* Stats Grid */}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Active Listings</CardTitle>
						<span className="text-2xl">📦</span>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<Skeleton className="h-8 w-20" />
						) : (
							<>
								<div className="text-2xl font-bold">{activeListings}</div>
								<p className="text-xs text-muted-foreground">{totalListings} total products</p>
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Sales</CardTitle>
						<span className="text-2xl">💰</span>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<Skeleton className="h-8 w-20" />
						) : (
							<>
								<div className="text-2xl font-bold">{sellerOrders.length}</div>
								<p className="text-xs text-muted-foreground">Orders received</p>
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Purchases</CardTitle>
						<span className="text-2xl">🛍️</span>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<Skeleton className="h-8 w-20" />
						) : (
							<>
								<div className="text-2xl font-bold">{buyerOrders.length}</div>
								<p className="text-xs text-muted-foreground">Orders placed</p>
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Messages</CardTitle>
						<span className="text-2xl">✉️</span>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<Skeleton className="h-8 w-20" />
						) : (
							<>
								<div className="text-2xl font-bold">{unreadMessages}</div>
								<p className="text-xs text-muted-foreground">Conversations</p>
							</>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Quick Actions */}
			<Card>
				<CardHeader>
					<CardTitle>Quick Actions</CardTitle>
					<CardDescription>Common tasks to get you started</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						<Link to="/dashboard/products/products/new">
							<Button variant="outline" className="w-full justify-start h-auto py-4">
								<div className="flex items-start gap-3">
									<span className="text-2xl">➕</span>
									<div className="text-left">
										<div className="font-semibold">Create Product</div>
										<div className="text-xs text-muted-foreground">List a new item for sale</div>
									</div>
								</div>
							</Button>
						</Link>

						<Link to="/dashboard/sales/sales">
							<Button variant="outline" className="w-full justify-start h-auto py-4">
								<div className="flex items-start gap-3">
									<span className="text-2xl">💰</span>
									<div className="text-left">
										<div className="font-semibold">View Sales</div>
										<div className="text-xs text-muted-foreground">Manage your orders</div>
									</div>
								</div>
							</Button>
						</Link>

						<Link to="/dashboard/sales/messages">
							<Button variant="outline" className="w-full justify-start h-auto py-4">
								<div className="flex items-start gap-3">
									<span className="text-2xl">✉️</span>
									<div className="text-left">
										<div className="font-semibold">Messages</div>
										<div className="text-xs text-muted-foreground">Chat with buyers/sellers</div>
									</div>
								</div>
							</Button>
						</Link>

						<Link to="/dashboard/products/collections">
							<Button variant="outline" className="w-full justify-start h-auto py-4">
								<div className="flex items-start gap-3">
									<span className="text-2xl">🗂️</span>
									<div className="text-left">
										<div className="font-semibold">Collections</div>
										<div className="text-xs text-muted-foreground">Organize your products</div>
									</div>
								</div>
							</Button>
						</Link>

						<Link to="/dashboard/products/receiving-payments">
							<Button variant="outline" className="w-full justify-start h-auto py-4">
								<div className="flex items-start gap-3">
									<span className="text-2xl">💸</span>
									<div className="text-left">
										<div className="font-semibold">Payment Settings</div>
										<div className="text-xs text-muted-foreground">Configure how you get paid</div>
									</div>
								</div>
							</Button>
						</Link>

						<Link to="/dashboard/account/profile">
							<Button variant="outline" className="w-full justify-start h-auto py-4">
								<div className="flex items-start gap-3">
									<span className="text-2xl">👤</span>
									<div className="text-left">
										<div className="font-semibold">Edit Profile</div>
										<div className="text-xs text-muted-foreground">Update your store info</div>
									</div>
								</div>
							</Button>
						</Link>
					</div>
				</CardContent>
			</Card>

			{/* Recent Activity */}
			<Card>
				<CardHeader>
					<CardTitle>Recent Orders</CardTitle>
					<CardDescription>Your latest marketplace activity</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="space-y-4">
							{[...Array(3)].map((_, i) => (
								<div key={i} className="flex items-center space-x-4">
									<Skeleton className="h-12 w-12 rounded-full" />
									<div className="space-y-2 flex-1">
										<Skeleton className="h-4 w-full" />
										<Skeleton className="h-4 w-3/4" />
									</div>
								</div>
							))}
						</div>
					) : recentOrders.length === 0 ? (
						<div className="text-center py-8">
							<p className="text-muted-foreground mb-4">No orders yet</p>
							<p className="text-sm text-muted-foreground mb-4">Start by creating a product listing or browsing the marketplace</p>
							<Link to="/dashboard/products/products/new">
								<Button>Create Your First Product</Button>
							</Link>
						</div>
					) : (
						<div className="space-y-4">
							{recentOrders.map((orderData) => {
								// Buyer = author of order, Seller = recipient (#p tag)
								const isBuyer = orderData.order.pubkey === userPubkey
								const statusTag = orderData.latestStatus?.tags.find((t) => t[0] === 'status')
								const status = statusTag?.[1] || 'pending'

								return (
									<Link
										key={orderData.order.id}
										to="/dashboard/orders/$orderId"
										params={{ orderId: orderData.order.id }}
										className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-colors"
									>
										<div className="flex items-center gap-4">
											<div className="flex items-center justify-center w-12 h-12 rounded-full bg-secondary text-2xl">
												{isBuyer ? '🛍️' : '💰'}
											</div>
											<div>
												<div className="font-medium">
													{isBuyer ? 'Purchase' : 'Sale'} #{orderData.order.id.slice(0, 8)}
												</div>
												<div className="text-sm text-muted-foreground">
													{new Date((orderData.order.created_at || 0) * 1000).toLocaleDateString()}
												</div>
											</div>
										</div>
										<Badge className="text-foreground" variant={status === 'completed' ? 'primary' : 'secondary'}>
											{status}
										</Badge>
									</Link>
								)
							})}
							<Link to="/dashboard/sales/sales">
								<Button variant="ghost" className="w-full">
									View All Orders →
								</Button>
							</Link>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Getting Started Guide (shown if user has no products) */}
			{!isLoading && totalListings === 0 && (
				<Card className="border-primary">
					<CardHeader>
						<CardTitle>Getting Started</CardTitle>
						<CardDescription>Welcome to your marketplace dashboard! Here's how to get started:</CardDescription>
					</CardHeader>
					<CardContent>
						<ol className="space-y-4">
							<li className="flex items-start gap-3">
								<span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-bold flex-shrink-0">
									1
								</span>
								<div>
									<div className="font-semibold">Set up your profile</div>
									<p className="text-sm text-muted-foreground">Add your store name, description, and contact info</p>
									<Link to="/dashboard/account/profile">
										<Button variant="link" className="p-0 h-auto">
											Go to Profile →
										</Button>
									</Link>
								</div>
							</li>
							<li className="flex items-start gap-3">
								<span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-bold flex-shrink-0">
									2
								</span>
								<div>
									<div className="font-semibold">Configure payment methods</div>
									<p className="text-sm text-muted-foreground">Set up how you'll receive payments from customers</p>
									<Link to="/dashboard/products/receiving-payments">
										<Button variant="link" className="p-0 h-auto">
											Set Up Payments →
										</Button>
									</Link>
								</div>
							</li>
							<li className="flex items-start gap-3">
								<span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-bold flex-shrink-0">
									3
								</span>
								<div>
									<div className="font-semibold">Create your first product</div>
									<p className="text-sm text-muted-foreground">List an item with photos, description, and pricing</p>
									<Link to="/dashboard/products/products/new">
										<Button variant="link" className="p-0 h-auto">
											Create Product →
										</Button>
									</Link>
								</div>
							</li>
							<li className="flex items-start gap-3">
								<span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-bold flex-shrink-0">
									4
								</span>
								<div>
									<div className="font-semibold">Set up shipping options</div>
									<p className="text-sm text-muted-foreground">Define how you'll deliver products to customers</p>
									<Link to="/dashboard/products/shipping-options">
										<Button variant="link" className="p-0 h-auto">
											Configure Shipping →
										</Button>
									</Link>
								</div>
							</li>
						</ol>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
