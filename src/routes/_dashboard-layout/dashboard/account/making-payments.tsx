import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useUserPaymentDetails } from '@/queries/payment'
import { useLightningPaymentDetailMutation } from '@/publish/payment'
import { ndkActions } from '@/lib/stores/ndk'
import { EyeIcon, EyeOffIcon, ScanIcon, ArrowLeftIcon, PlusIcon, TrashIcon } from 'lucide-react'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { uiStore } from '@/lib/stores/ui'
import { useWallets, parseNwcUri, type Wallet } from '@/lib/stores/wallet'
import { useStore } from '@tanstack/react-store'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/making-payments')({
	component: MakingPaymentsComponent,
})

function MakingPaymentsComponent() {
	// Use the wallet store instead of local state
	const { wallets, addWallet, removeWallet, isLoading, isInitialized } = useWallets();
	
	// Form state for adding a new wallet
	const [isAddingWallet, setIsAddingWallet] = useState(false);
	const [nwcUri, setNwcUri] = useState('');
	const [nwcPubkey, setNwcPubkey] = useState('');
	const [nwcRelays, setNwcRelays] = useState('');
	const [nwcSecret, setNwcSecret] = useState('');
	const [showSecret, setShowSecret] = useState(false);
	const [storeOnNostr, setStoreOnNostr] = useState(false);
	
	// Get current user's pubkey (to check if Nostr storage is available)
	const [userPubkey, setUserPubkey] = useState<string | null>(null);
	const signer = ndkActions.getSigner();
	
	useEffect(() => {
		const getUser = async () => {
			if (signer) {
				const user = await signer.user();
				if (user && user.pubkey) {
					setUserPubkey(user.pubkey);
				}
			}
		};
		
		getUser();
	}, [signer]);
	
	const handleCancelAdd = () => {
		setIsAddingWallet(false);
		resetForm();
	};
	
	const resetForm = () => {
		setNwcUri('');
		setNwcPubkey('');
		setNwcRelays('');
		setNwcSecret('');
		setShowSecret(false);
		setStoreOnNostr(false);
	};
	
	const handleAddWallet = () => {
		setIsAddingWallet(true);
		resetForm();
	};
	
	const handleNwcUriChange = (uri: string) => {
		setNwcUri(uri);
		const parsed = parseNwcUri(uri);
		if (parsed) {
			setNwcPubkey(parsed.pubkey);
			setNwcRelays(parsed.relay);
			setNwcSecret(parsed.secret);
		}
	};
	
	const handlePaste = async () => {
		try {
			const text = await navigator.clipboard.readText();
			handleNwcUriChange(text);
		} catch (e) {
			console.error('Failed to read clipboard:', e);
			toast.error('Could not access clipboard');
		}
	};
	
	const handleScan = () => {
		// Open the QR scanner dialog with a callback
		uiStore.setState((state) => ({
			...state,
			dialogs: {
				...state.dialogs,
				'scan-qr': true,
			},
			dialogCallbacks: {
				...state.dialogCallbacks,
				'scan-qr': (scannedUri: string) => {
					handleNwcUriChange(scannedUri);
					setIsAddingWallet(true);
					toast.success('QR code scanned successfully');
				}
			},
			activeElement: 'dialog-scan-qr',
		}));
	};
	
	const saveWallet = async () => {
		try {
			// Validate inputs
			if (!nwcPubkey) {
				toast.error('Wallet pubkey is required');
				return;
			}
			
			if (!nwcRelays) {
				toast.error('At least one relay is required');
				return;
			}
			
			// Check if we're logged in (required for Nostr storage)
			if (storeOnNostr && !userPubkey) {
				toast.warning('You need to be logged in to store wallets on Nostr. Wallet will be saved locally only.');
				setStoreOnNostr(false);
			}
			
			// Create full NWC URI if we only have components
			let finalNwcUri = nwcUri;
			if (!finalNwcUri || !finalNwcUri.startsWith('nostr+walletconnect://')) {
				finalNwcUri = `nostr+walletconnect://${nwcPubkey}?relay=${encodeURIComponent(nwcRelays)}&secret=${nwcSecret}`;
			}
			
			// Create the wallet object
			const newWallet: Omit<Wallet, 'id' | 'createdAt' | 'updatedAt'> = {
				name: `Wallet ${wallets.length + 1}`,
				nwcUri: finalNwcUri,
				pubkey: nwcPubkey,
				relays: nwcRelays.split(',').map(r => r.trim()),
			};
			
			// Add the wallet using the store
			await addWallet(newWallet, storeOnNostr);
			
			// Reset form and close
			setIsAddingWallet(false);
			resetForm();
		} catch (error) {
			console.error('Error saving wallet:', error);
			toast.error('Failed to save wallet');
		}
	};
	
	const handleDeleteWallet = async (walletId: string) => {
		try {
			await removeWallet(walletId);
		} catch (error) {
			console.error('Error removing wallet:', error);
			toast.error('Failed to remove wallet');
		}
	};
	
	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="flex flex-col items-center gap-2">
					<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
					<p className="text-muted-foreground">Loading wallets...</p>
				</div>
			</div>
		);
	}
	
	if (isAddingWallet) {
		return (
			<div className="space-y-6">
				<div className="flex items-center space-x-2">
					<Button
						variant="ghost"
						size="icon"
						onClick={handleCancelAdd}
						aria-label="Back"
					>
						<ArrowLeftIcon className="h-4 w-4" />
					</Button>
					<h1 className="text-2xl font-bold">Add Wallet</h1>
				</div>
				
				<Card>
					<CardHeader>
						<CardTitle>Add Nostr Wallet Connect</CardTitle>
						<CardDescription>
							Paste your Nostr Wallet Connect URI or scan a QR code to connect your wallet.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex space-x-2">
							<Button onClick={handlePaste} className="flex-1 bg-yellow-500 hover:bg-yellow-600">
								Paste
							</Button>
							<Button onClick={handleScan} className="flex-1">
								<ScanIcon className="h-4 w-4 mr-2" /> Scan
							</Button>
						</div>
						
						<div className="space-y-4 mt-4">
							<div>
								<Label htmlFor="wallet-pubkey">Wallet Connect Pubkey</Label>
								<Input
									id="wallet-pubkey"
									placeholder="e.g 60b37aeb4c521316374bab549c074abc..."
									value={nwcPubkey}
									onChange={(e) => setNwcPubkey(e.target.value)}
								/>
							</div>
							
							<div>
								<Label htmlFor="wallet-relays">Wallet Connect Relays</Label>
								<Input
									id="wallet-relays"
									placeholder="e.g wss://relay.nostr.band"
									value={nwcRelays}
									onChange={(e) => setNwcRelays(e.target.value)}
								/>
							</div>
							
							<div>
								<Label htmlFor="wallet-secret">Wallet Connect Secret</Label>
								<div className="flex">
									<Input
										id="wallet-secret"
										type={showSecret ? "text" : "password"}
										placeholder="Secret"
										value={nwcSecret}
										onChange={(e) => setNwcSecret(e.target.value)}
										className="flex-1"
									/>
									<Button
										variant="outline"
										size="icon"
										onClick={() => setShowSecret(!showSecret)}
										className="ml-2"
									>
										{showSecret ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
									</Button>
								</div>
							</div>
							
							{userPubkey && (
								<div className="flex items-center space-x-2">
									<Checkbox
										id="store-wallet"
										checked={storeOnNostr}
										onCheckedChange={(checked) => setStoreOnNostr(checked === true)}
									/>
									<Label htmlFor="store-wallet">Store wallet on Nostr (encrypted)</Label>
								</div>
							)}
						</div>
					</CardContent>
					<CardFooter className="flex justify-between">
						<Button variant="outline" onClick={handleCancelAdd}>
							Cancel
						</Button>
						<Button onClick={saveWallet}>
							Save Wallet
						</Button>
					</CardFooter>
				</Card>
			</div>
		);
	}
	
	return (
		<div className="space-y-6">
			<div className="flex justify-between items-center">
				<h1 className="text-2xl font-bold">Making Payments</h1>
				<Button onClick={handleAddWallet}>
					<PlusIcon className="h-4 w-4 mr-2" /> Add Another Wallet
				</Button>
			</div>
			
			{wallets.length === 0 ? (
				<Card>
					<CardContent className="py-10 flex flex-col items-center justify-center">
						<p className="text-center text-muted-foreground mb-4">
							No wallets configured yet. Add a wallet to make payments.
						</p>
						<Button onClick={handleAddWallet}>
							<PlusIcon className="h-4 w-4 mr-2" /> Add Wallet
						</Button>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-4">
					{wallets.map((wallet) => (
						<Card key={wallet.id}>
							<CardHeader className="pb-2">
								<div className="flex justify-between items-center">
									<CardTitle>{wallet.name}</CardTitle>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => handleDeleteWallet(wallet.id)}
										className="h-8 w-8 text-destructive"
									>
										<TrashIcon className="h-4 w-4" />
									</Button>
								</div>
								<CardDescription>
									{wallet.storedOnNostr ? 'Stored on Nostr (encrypted)' : 'Stored locally'}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="text-sm space-y-1">
									<p className="font-medium">Public Key:</p>
									<p className="text-muted-foreground font-mono text-xs truncate">
										{wallet.pubkey}
									</p>
									
									{wallet.relays && (
										<>
											<p className="font-medium mt-2">Relays:</p>
											<p className="text-muted-foreground font-mono text-xs truncate">
												{Array.isArray(wallet.relays) 
													? wallet.relays.join(', ')
													: typeof wallet.relays === 'string' 
														? wallet.relays 
														: 'Unknown'
												}
											</p>
										</>
									)}
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}