import type { ExtensionPaymentRequirement } from '@sdk/core/extensions'
import { Button } from '@ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ui/primitives/dialog'

function host(url: string): string {
	try {
		return new URL(url).host
	} catch {
		return url
	}
}

/** Shows the price of one extension call before the user's wallet pays anything. */
export function PaidCallConfirmDialog({
	requirement,
	onApprove,
	onDecline,
}: {
	requirement: ExtensionPaymentRequirement | undefined
	onApprove: () => void
	onDecline: () => void
}) {
	return (
		<Dialog open={Boolean(requirement)} onOpenChange={(open) => !open && onDecline()}>
			<DialogContent className="sm:max-w-md" data-testid="paid-call-dialog">
				<DialogHeader>
					<DialogTitle>Pay {requirement?.amountSats} sats?</DialogTitle>
					<DialogDescription>{requirement?.description ?? 'This extension is paid per use.'}</DialogDescription>
				</DialogHeader>
				{requirement && (
					<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
						<dt className="text-muted-foreground">Paid to</dt>
						<dd className="break-all" data-testid="paid-call-payee">
							{host(requirement.payee)}
						</dd>
						<dt className="text-muted-foreground">From</dt>
						<dd className="break-all">Your wallet ({requirement.mints.map(host).join(', ')})</dd>
						<dt className="text-muted-foreground">Change</dt>
						<dd>{requirement.refundsChange ? 'Unused sats are returned to your wallet' : 'None'}</dd>
					</dl>
				)}
				<p className="text-xs text-muted-foreground">
					Paid directly from your Cashu wallet. This marketplace does not receive the payment.
				</p>
				<DialogFooter>
					<Button variant="outline" onClick={onDecline} data-testid="paid-call-decline">
						Cancel
					</Button>
					<Button onClick={onApprove} data-testid="paid-call-approve">
						Pay {requirement?.amountSats} sats
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
