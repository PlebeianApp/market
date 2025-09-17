import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ndkActions } from '@/lib/stores/ndk'
import { getATagFromCoords, getCoordsFromATag } from '@/lib/utils/coords'
import {
	addToFeaturedCollections,
	addToFeaturedProducts,
	addToFeaturedUsers,
	removeFromFeaturedCollections,
	removeFromFeaturedProducts,
	removeFromFeaturedUsers,
	reorderFeaturedCollections,
	reorderFeaturedProducts,
	reorderFeaturedUsers,
} from '@/publish/featured'
import { useUserRole } from '@/queries/app-settings'
import { fetchCollection, getCollectionId } from '@/queries/collections'
import { useConfigQuery } from '@/queries/config'
import { useFeaturedCollections, useFeaturedProducts, useFeaturedUsers } from '@/queries/featured'
import { fetchProduct, fetchProductByATag, getProductId, getProductTitle } from '@/queries/products'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { formatPubkeyForDisplay, npubToHex } from '@/routes/setup'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronDown, ChevronUp, FolderOpen, Package, Plus, Star, Trash2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/featured-items')({
	component: FeaturedItemsComponent,
})

// Helper functions for coordinate conversion and display
const getProductDisplayInfo = async (productCoords: string) => {
	try {
		const coords = getCoordsFromATag(productCoords)
		if (coords.kind !== 30402) return { id: coords.identifier, title: 'Unknown Product', coords: productCoords }

		const product = await fetchProductByATag(coords.pubkey, coords.identifier)
		const title = product ? getProductTitle(product) : 'Product Not Found'

		return {
			id: coords.identifier,
			title,
			coords: productCoords,
		}
	} catch (error) {
		return { id: 'invalid', title: 'Invalid Coordinate', coords: productCoords }
	}
}

const convertInputToCoords = async (input: string, authorPubkey?: string): Promise<string> => {
	// If input is already a coordinate (contains colons), return as-is
	if (input.includes(':')) {
		try {
			getCoordsFromATag(input) // Validate format
			return input
		} catch {
			throw new Error('Invalid coordinate format')
		}
	}

	// If input is just an ID, fetch the product to get its real dtag and pubkey
	try {
		const productEvent = await fetchProduct(input)
		if (!productEvent) {
			throw new Error('Product not found')
		}

		const realDtag = getProductId(productEvent)
		if (!realDtag) {
			throw new Error('Product has no dtag')
		}

		// Create coordinates using the product's actual pubkey and dtag
		return getATagFromCoords({ kind: 30402, pubkey: productEvent.pubkey, identifier: realDtag })
	} catch (error) {
		throw new Error(`Failed to convert product ID to coordinates: ${error instanceof Error ? error.message : 'Unknown error'}`)
	}
}

const convertCollectionInputToCoords = async (input: string, authorPubkey?: string): Promise<string> => {
	// If input is already a coordinate (contains colons), return as-is
	if (input.includes(':')) {
		try {
			getCoordsFromATag(input) // Validate format
			return input
		} catch {
			throw new Error('Invalid coordinate format')
		}
	}

	// If input is just an ID, fetch the collection to get its real dtag and pubkey
	try {
		const collectionEvent = await fetchCollection(input)
		if (!collectionEvent) {
			throw new Error('Collection not found')
		}

		const realDtag = getCollectionId(collectionEvent)
		if (!realDtag) {
			throw new Error('Collection has no dtag')
		}

		// Create coordinates using the collection's actual pubkey and dtag
		return getATagFromCoords({ kind: 30405, pubkey: collectionEvent.pubkey, identifier: realDtag })
	} catch (error) {
		throw new Error(`Failed to convert collection ID to coordinates: ${error instanceof Error ? error.message : 'Unknown error'}`)
	}
}

// Component to display product information
function ProductDisplayItem({
	productCoords,
	index,
	onMoveUp,
	onMoveDown,
	onRemove,
	canMoveUp,
	canMoveDown,
	isReordering,
	isRemoving,
}: {
	productCoords: string
	index: number
	onMoveUp: () => void
	onMoveDown: () => void
	onRemove: () => void
	canMoveUp: boolean
	canMoveDown: boolean
	isReordering: boolean
	isRemoving: boolean
}) {
	const [displayInfo, setDisplayInfo] = useState<{ id: string; title: string; coords: string }>({
		id: 'loading...',
		title: 'Loading...',
		coords: productCoords,
	})

	// Load product info on mount
	useEffect(() => {
		getProductDisplayInfo(productCoords).then(setDisplayInfo)
	}, [productCoords])

	return (
		<div className="flex items-center justify-between p-3 border rounded-lg">
			<div className="flex items-center gap-3">
				<div className="flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-600 rounded-full text-sm font-medium">
					{index + 1}
				</div>
				<div>
					<div className="font-medium">{displayInfo.title}</div>
					<div className="text-sm text-gray-500">ID: {displayInfo.id}</div>
					<div className="text-xs text-gray-400 font-mono">{displayInfo.coords}</div>
				</div>
			</div>
			<div className="flex items-center gap-1">
				<Button variant="outline" size="sm" onClick={onMoveUp} disabled={!canMoveUp || isReordering} title="Move up">
					<ChevronUp className="w-4 h-4" />
				</Button>
				<Button variant="outline" size="sm" onClick={onMoveDown} disabled={!canMoveDown || isReordering} title="Move down">
					<ChevronDown className="w-4 h-4" />
				</Button>
				<Button variant="outline" size="sm" onClick={onRemove} disabled={isRemoving} title="Remove from featured">
					<Trash2 className="w-4 h-4 text-red-600" />
				</Button>
			</div>
		</div>
	)
}

function FeaturedItemsComponent() {
	useDashboardTitle('Featured Items')
	const { data: config } = useConfigQuery()
	const { data: featuredProducts, isLoading: isLoadingProducts } = useFeaturedProducts(config?.appPublicKey || '')
	const { data: featuredCollections, isLoading: isLoadingCollections } = useFeaturedCollections(config?.appPublicKey || '')
	const { data: featuredUsers, isLoading: isLoadingUsers } = useFeaturedUsers(config?.appPublicKey || '')
	const { amIAdmin, amIEditor, isLoading: isLoadingPermissions } = useUserRole(config?.appPublicKey)

	// State for adding new items
	const [newProductInput, setNewProductInput] = useState('')
	const [newCollectionInput, setNewCollectionInput] = useState('')
	const [newUserInput, setNewUserInput] = useState('')
	const [isAddingProduct, setIsAddingProduct] = useState(false)
	const [isAddingCollection, setIsAddingCollection] = useState(false)
	const [isAddingUser, setIsAddingUser] = useState(false)

	// Mutation hooks
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	const addProductMutation = useMutation({
		mutationFn: async ({ productCoords, appPubkey }: { productCoords: string; appPubkey?: string }) => {
			if (!ndk || !signer) throw new Error('NDK or signer not available')
			return addToFeaturedProducts(productCoords, signer, ndk, appPubkey)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['config'] })
		},
	})

	const removeProductMutation = useMutation({
		mutationFn: async ({ productCoords, appPubkey }: { productCoords: string; appPubkey?: string }) => {
			if (!ndk || !signer) throw new Error('NDK or signer not available')
			return removeFromFeaturedProducts(productCoords, signer, ndk, appPubkey)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['config'] })
		},
	})

	const reorderProductsMutation = useMutation({
		mutationFn: async ({ fromIndex, toIndex, appPubkey }: { fromIndex: number; toIndex: number; appPubkey?: string }) => {
			if (!featuredProducts?.featuredProducts || !ndk || !signer) throw new Error('Missing data or NDK/signer')
			const reordered = [...featuredProducts.featuredProducts]
			const [moved] = reordered.splice(fromIndex, 1)
			reordered.splice(toIndex, 0, moved)
			return reorderFeaturedProducts(reordered, signer, ndk)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['config'] })
		},
	})

	const addCollectionMutation = useMutation({
		mutationFn: async ({ collectionCoords, appPubkey }: { collectionCoords: string; appPubkey?: string }) => {
			if (!ndk || !signer) throw new Error('NDK or signer not available')
			return addToFeaturedCollections(collectionCoords, signer, ndk, appPubkey)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['config'] })
		},
	})

	const removeCollectionMutation = useMutation({
		mutationFn: async ({ collectionCoords, appPubkey }: { collectionCoords: string; appPubkey?: string }) => {
			if (!ndk || !signer) throw new Error('NDK or signer not available')
			return removeFromFeaturedCollections(collectionCoords, signer, ndk, appPubkey)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['config'] })
		},
	})

	const reorderCollectionsMutation = useMutation({
		mutationFn: async ({ fromIndex, toIndex, appPubkey }: { fromIndex: number; toIndex: number; appPubkey?: string }) => {
			if (!featuredCollections?.featuredCollections || !ndk || !signer) throw new Error('Missing data or NDK/signer')
			const reordered = [...featuredCollections.featuredCollections]
			const [moved] = reordered.splice(fromIndex, 1)
			reordered.splice(toIndex, 0, moved)
			return reorderFeaturedCollections(reordered, signer, ndk)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['config'] })
		},
	})

	const addUserMutation = useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk || !signer) throw new Error('NDK or signer not available')
			return addToFeaturedUsers(userPubkey, signer, ndk, appPubkey)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['config'] })
		},
	})

	const removeUserMutation = useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk || !signer) throw new Error('NDK or signer not available')
			return removeFromFeaturedUsers(userPubkey, signer, ndk, appPubkey)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['config'] })
		},
	})

	const reorderUsersMutation = useMutation({
		mutationFn: async ({ fromIndex, toIndex, appPubkey }: { fromIndex: number; toIndex: number; appPubkey?: string }) => {
			if (!featuredUsers?.featuredUsers || !ndk || !signer) throw new Error('Missing data or NDK/signer')
			const reordered = [...featuredUsers.featuredUsers]
			const [moved] = reordered.splice(fromIndex, 1)
			reordered.splice(toIndex, 0, moved)
			return reorderFeaturedUsers(reordered, signer, ndk)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['config'] })
		},
	})

	// Helper functions
	const handleAddProduct = async () => {
		if (!newProductInput.trim()) {
			toast.error('Please enter a product ID or coordinate (e.g., "my-product-id" or "30402:pubkey:d-tag")')
			return
		}

		try {
			setIsAddingProduct(true)

			// Convert input to coordinates if needed
			const productCoords = await convertInputToCoords(newProductInput.trim(), config?.appPublicKey)

			await addProductMutation.mutateAsync({
				productCoords,
				appPubkey: config?.appPublicKey,
			})
			setNewProductInput('')
			toast.success('Product added to featured list')
		} catch (error) {
			console.error('Failed to add product:', error)
			toast.error(`Failed to add product: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setIsAddingProduct(false)
		}
	}

	const handleAddCollection = async () => {
		if (!newCollectionInput.trim()) {
			toast.error('Please enter a collection ID or coordinate (e.g., "my-collection-id" or "30405:pubkey:d-tag")')
			return
		}

		try {
			setIsAddingCollection(true)

			// Convert input to coordinates if needed
			const collectionCoords = await convertCollectionInputToCoords(newCollectionInput.trim(), config?.appPublicKey)

			await addCollectionMutation.mutateAsync({
				collectionCoords,
				appPubkey: config?.appPublicKey,
			})
			setNewCollectionInput('')
			toast.success('Collection added to featured list')
		} catch (error) {
			console.error('Failed to add collection:', error)
			toast.error(`Failed to add collection: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setIsAddingCollection(false)
		}
	}

	const handleAddUser = async () => {
		if (!newUserInput.trim()) {
			toast.error('Please enter a valid npub or pubkey')
			return
		}

		try {
			setIsAddingUser(true)
			// Convert npub to hex if needed
			const hexPubkey = npubToHex(newUserInput.trim())
			await addUserMutation.mutateAsync({
				userPubkey: hexPubkey,
				appPubkey: config?.appPublicKey,
			})
			setNewUserInput('')
			toast.success('User added to featured list')
		} catch (error) {
			console.error('Failed to add user:', error)
			toast.error(`Failed to add user: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setIsAddingUser(false)
		}
	}

	// Reorder functions
	const handleMoveProductUp = async (index: number) => {
		if (index === 0 || !featuredProducts?.featuredProducts) return
		try {
			await reorderProductsMutation.mutateAsync({
				fromIndex: index,
				toIndex: index - 1,
				appPubkey: config?.appPublicKey,
			})
		} catch (error) {
			console.error('Failed to reorder products:', error)
		}
	}

	const handleMoveProductDown = async (index: number) => {
		if (!featuredProducts?.featuredProducts || index === featuredProducts.featuredProducts.length - 1) return
		try {
			await reorderProductsMutation.mutateAsync({
				fromIndex: index,
				toIndex: index + 1,
				appPubkey: config?.appPublicKey,
			})
		} catch (error) {
			console.error('Failed to reorder products:', error)
		}
	}

	const handleMoveCollectionUp = async (index: number) => {
		if (index === 0 || !featuredCollections?.featuredCollections) return
		try {
			await reorderCollectionsMutation.mutateAsync({
				fromIndex: index,
				toIndex: index - 1,
				appPubkey: config?.appPublicKey,
			})
		} catch (error) {
			console.error('Failed to reorder collections:', error)
		}
	}

	const handleMoveCollectionDown = async (index: number) => {
		if (!featuredCollections?.featuredCollections || index === featuredCollections.featuredCollections.length - 1) return
		try {
			await reorderCollectionsMutation.mutateAsync({
				fromIndex: index,
				toIndex: index + 1,
				appPubkey: config?.appPublicKey,
			})
		} catch (error) {
			console.error('Failed to reorder collections:', error)
		}
	}

	const handleMoveUserUp = async (index: number) => {
		if (index === 0 || !featuredUsers?.featuredUsers) return
		try {
			await reorderUsersMutation.mutateAsync({
				fromIndex: index,
				toIndex: index - 1,
				appPubkey: config?.appPublicKey,
			})
		} catch (error) {
			console.error('Failed to reorder users:', error)
		}
	}

	const handleMoveUserDown = async (index: number) => {
		if (!featuredUsers?.featuredUsers || index === featuredUsers.featuredUsers.length - 1) return
		try {
			await reorderUsersMutation.mutateAsync({
				fromIndex: index,
				toIndex: index + 1,
				appPubkey: config?.appPublicKey,
			})
		} catch (error) {
			console.error('Failed to reorder users:', error)
		}
	}

	// Remove functions
	const handleRemoveProduct = async (productCoords: string) => {
		try {
			await removeProductMutation.mutateAsync({
				productCoords,
				appPubkey: config?.appPublicKey,
			})
			toast.success('Product removed from featured list')
		} catch (error) {
			console.error('Failed to remove product:', error)
		}
	}

	const handleRemoveCollection = async (collectionCoords: string) => {
		try {
			await removeCollectionMutation.mutateAsync({
				collectionCoords,
				appPubkey: config?.appPublicKey,
			})
			toast.success('Collection removed from featured list')
		} catch (error) {
			console.error('Failed to remove collection:', error)
		}
	}

	const handleRemoveUser = async (userPubkey: string) => {
		try {
			await removeUserMutation.mutateAsync({
				userPubkey,
				appPubkey: config?.appPublicKey,
			})
			toast.success('User removed from featured list')
		} catch (error) {
			console.error('Failed to remove user:', error)
		}
	}

	if (isLoadingProducts || isLoadingCollections || isLoadingUsers || isLoadingPermissions) {
		return (
			<div className="space-y-6 p-6">
				<div className="animate-pulse">
					<div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
					<div className="space-y-3">
						<div className="h-4 bg-gray-200 rounded w-1/2"></div>
						<div className="h-4 bg-gray-200 rounded w-1/3"></div>
					</div>
				</div>
			</div>
		)
	}

	if (!amIAdmin && !amIEditor) {
		return (
			<div className="space-y-6 p-6">
				<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
					<div className="flex items-center gap-3">
						<Star className="w-6 h-6 text-muted-foreground" />
						<div>
							<h1 className="text-2xl font-bold">Featured Items</h1>
							<p className="text-muted-foreground text-sm">Manage featured items</p>
						</div>
					</div>
				</div>

				<Card>
					<CardContent className="p-6">
						<div className="text-center">
							<Star className="w-16 h-16 mx-auto text-gray-400 mb-4" />
							<h3 className="text-lg font-medium mb-2">Access Denied</h3>
							<p className="text-gray-600">You don't have permission to manage featured items.</p>
						</div>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<div className="flex items-center gap-3">
					<Star className="w-6 h-6 text-muted-foreground" />
					<div>
						<h1 className="text-2xl font-bold">Featured Items</h1>
						<p className="text-muted-foreground text-sm">Manage featured products, collections, and users</p>
					</div>
				</div>
			</div>
			<div className="space-y-6 p-4 lg:p-8">
				<div className="lg:hidden mb-6">
					<div className="flex items-center gap-3">
						<Star className="w-6 h-6 text-muted-foreground" />
						<div>
							<h1 className="text-2xl font-bold">Featured Items</h1>
							<p className="text-muted-foreground text-sm">Manage featured products, collections, and users</p>
						</div>
					</div>
				</div>

				<Tabs defaultValue="products" className="w-full">
					<TabsList className="grid w-full grid-cols-3">
						<TabsTrigger value="products" className="flex items-center gap-2">
							<Package className="w-4 h-4" />
							Products
						</TabsTrigger>
						<TabsTrigger value="collections" className="flex items-center gap-2">
							<FolderOpen className="w-4 h-4" />
							Collections
						</TabsTrigger>
						<TabsTrigger value="users" className="flex items-center gap-2">
							<Users className="w-4 h-4" />
							Users
						</TabsTrigger>
					</TabsList>

					{/* Featured Products Tab */}
					<TabsContent value="products" className="space-y-6">
						{/* Current Featured Products */}
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Package className="w-5 h-5" />
									Featured Products
								</CardTitle>
								<CardDescription>
									Products highlighted on the marketplace homepage. Order matters - use up/down buttons to reorder.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								{!featuredProducts?.featuredProducts || featuredProducts.featuredProducts.length === 0 ? (
									<div className="text-center py-8 text-gray-500">
										<Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
										<p>No featured products yet</p>
									</div>
								) : (
									<div className="space-y-3">
										{featuredProducts.featuredProducts.map((productCoords, index) => (
											<ProductDisplayItem
												key={productCoords}
												productCoords={productCoords}
												index={index}
												onMoveUp={() => handleMoveProductUp(index)}
												onMoveDown={() => handleMoveProductDown(index)}
												onRemove={() => handleRemoveProduct(productCoords)}
												canMoveUp={index > 0}
												canMoveDown={index < featuredProducts.featuredProducts.length - 1}
												isReordering={reorderProductsMutation.isPending}
												isRemoving={removeProductMutation.isPending}
											/>
										))}
									</div>
								)}
							</CardContent>
						</Card>

						{/* Add Product */}
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Plus className="w-5 h-5" />
									Add Featured Product
								</CardTitle>
								<CardDescription>Add a product to the featured list using its ID or full coordinate.</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="newProduct">Product ID or Coordinate</Label>
									<div className="flex gap-2">
										<Input
											id="newProduct"
											value={newProductInput}
											onChange={(e) => setNewProductInput(e.target.value)}
											placeholder="my-product-id or 30402:pubkey:d-tag"
											className="flex-1"
										/>
										<Button
											onClick={handleAddProduct}
											disabled={isAddingProduct || addProductMutation.isPending || !newProductInput.trim()}
										>
											{isAddingProduct || addProductMutation.isPending ? (
												<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
											) : (
												<Plus className="w-4 h-4" />
											)}
											Add
										</Button>
									</div>
								</div>
								<div className="text-xs text-gray-500">
									Note: Products will be displayed in the order they appear in the list. Use the up/down buttons to reorder.
								</div>
							</CardContent>
						</Card>
					</TabsContent>

					{/* Featured Collections Tab */}
					<TabsContent value="collections" className="space-y-6">
						{/* Current Featured Collections */}
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<FolderOpen className="w-5 h-5" />
									Featured Collections
								</CardTitle>
								<CardDescription>
									Collections highlighted on the marketplace homepage. Order matters - use up/down buttons to reorder.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								{!featuredCollections?.featuredCollections || featuredCollections.featuredCollections.length === 0 ? (
									<div className="text-center py-8 text-gray-500">
										<FolderOpen className="w-12 h-12 mx-auto mb-3 text-gray-300" />
										<p>No featured collections yet</p>
									</div>
								) : (
									<div className="space-y-3">
										{featuredCollections.featuredCollections.map((collectionCoords, index) => (
											<div key={collectionCoords} className="flex items-center justify-between p-3 border rounded-lg">
												<div className="flex items-center gap-3">
													<div className="flex items-center justify-center w-8 h-8 bg-purple-100 text-purple-600 rounded-full text-sm font-medium">
														{index + 1}
													</div>
													<div>
														<div className="font-mono text-sm">{collectionCoords}</div>
														<div className="text-xs text-purple-600 font-medium">Featured Collection</div>
													</div>
												</div>
												<div className="flex items-center gap-1">
													<Button
														variant="outline"
														size="sm"
														onClick={() => handleMoveCollectionUp(index)}
														disabled={index === 0 || reorderCollectionsMutation.isPending}
														title="Move up"
													>
														<ChevronUp className="w-4 h-4" />
													</Button>
													<Button
														variant="outline"
														size="sm"
														onClick={() => handleMoveCollectionDown(index)}
														disabled={index === featuredCollections.featuredCollections.length - 1 || reorderCollectionsMutation.isPending}
														title="Move down"
													>
														<ChevronDown className="w-4 h-4" />
													</Button>
													<Button
														variant="outline"
														size="sm"
														onClick={() => handleRemoveCollection(collectionCoords)}
														disabled={removeCollectionMutation.isPending}
														title="Remove from featured"
													>
														<Trash2 className="w-4 h-4 text-red-600" />
													</Button>
												</div>
											</div>
										))}
									</div>
								)}
							</CardContent>
						</Card>

						{/* Add Collection */}
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Plus className="w-5 h-5" />
									Add Featured Collection
								</CardTitle>
								<CardDescription>Add a collection to the featured list using its coordinate (30405:pubkey:d-tag).</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="newCollection">Collection Coordinate</Label>
									<div className="flex gap-2">
										<Input
											id="newCollection"
											value={newCollectionInput}
											onChange={(e) => setNewCollectionInput(e.target.value)}
											placeholder="30405:pubkey:d-tag"
											className="flex-1"
										/>
										<Button
											onClick={handleAddCollection}
											disabled={isAddingCollection || addCollectionMutation.isPending || !newCollectionInput.trim()}
										>
											{isAddingCollection || addCollectionMutation.isPending ? (
												<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
											) : (
												<Plus className="w-4 h-4" />
											)}
											Add
										</Button>
									</div>
								</div>
								<div className="text-xs text-gray-500">
									Note: Collections will be displayed in the order they appear in the list. Use the up/down buttons to reorder.
								</div>
							</CardContent>
						</Card>
					</TabsContent>

					{/* Featured Users Tab */}
					<TabsContent value="users" className="space-y-6">
						{/* Current Featured Users */}
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Users className="w-5 h-5" />
									Featured Users
								</CardTitle>
								<CardDescription>
									Users highlighted on the marketplace homepage. Order matters - use up/down buttons to reorder.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								{!featuredUsers?.featuredUsers || featuredUsers.featuredUsers.length === 0 ? (
									<div className="text-center py-8 text-gray-500">
										<Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
										<p>No featured users yet</p>
									</div>
								) : (
									<div className="space-y-3">
										{featuredUsers.featuredUsers.map((userPubkey, index) => (
											<div key={userPubkey} className="flex items-center justify-between p-3 border rounded-lg">
												<div className="flex items-center gap-3">
													<div className="flex items-center justify-center w-8 h-8 bg-green-100 text-green-600 rounded-full text-sm font-medium">
														{index + 1}
													</div>
													<div>
														<div className="font-mono text-sm">{formatPubkeyForDisplay(userPubkey)}</div>
														<div className="text-xs text-green-600 font-medium">Featured User</div>
													</div>
												</div>
												<div className="flex items-center gap-1">
													<Button
														variant="outline"
														size="sm"
														onClick={() => handleMoveUserUp(index)}
														disabled={index === 0 || reorderUsersMutation.isPending}
														title="Move up"
													>
														<ChevronUp className="w-4 h-4" />
													</Button>
													<Button
														variant="outline"
														size="sm"
														onClick={() => handleMoveUserDown(index)}
														disabled={index === featuredUsers.featuredUsers.length - 1 || reorderUsersMutation.isPending}
														title="Move down"
													>
														<ChevronDown className="w-4 h-4" />
													</Button>
													<Button
														variant="outline"
														size="sm"
														onClick={() => handleRemoveUser(userPubkey)}
														disabled={removeUserMutation.isPending}
														title="Remove from featured"
													>
														<Trash2 className="w-4 h-4 text-red-600" />
													</Button>
												</div>
											</div>
										))}
									</div>
								)}
							</CardContent>
						</Card>

						{/* Add User */}
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Plus className="w-5 h-5" />
									Add Featured User
								</CardTitle>
								<CardDescription>Add a user to the featured list using their npub or public key.</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="newUser">Npub or Public Key</Label>
									<div className="flex gap-2">
										<Input
											id="newUser"
											value={newUserInput}
											onChange={(e) => setNewUserInput(e.target.value)}
											placeholder="npub1... or hex pubkey"
											className="flex-1"
										/>
										<Button onClick={handleAddUser} disabled={isAddingUser || addUserMutation.isPending || !newUserInput.trim()}>
											{isAddingUser || addUserMutation.isPending ? (
												<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
											) : (
												<Plus className="w-4 h-4" />
											)}
											Add
										</Button>
									</div>
								</div>
								<div className="text-xs text-gray-500">
									Note: Users will be displayed in the order they appear in the list. Use the up/down buttons to reorder.
								</div>
							</CardContent>
						</Card>
					</TabsContent>
				</Tabs>

				{/* Permissions Info */}
				<Card>
					<CardHeader>
						<CardTitle>Your Permissions</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="flex items-center gap-3">
							{amIAdmin ? <Star className="w-5 h-5 text-blue-600" /> : <Star className="w-5 h-5 text-purple-600" />}
							<div>
								<div className="font-medium">{amIAdmin ? 'Administrator' : 'Editor'}</div>
								<div className="text-sm text-gray-600">
									{amIAdmin
										? 'You have full control over the marketplace and can manage featured items.'
										: 'You can manage featured items but have limited administrative access.'}
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
