import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

export const TERMS_ACCEPTED_KEY = 'plebeian_terms_accepted'

interface TermsConditionsDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onAccept: () => void
}

export function TermsConditionsDialog({ open, onOpenChange, onAccept }: TermsConditionsDialogProps) {
	const handleAccept = () => {
		localStorage.setItem(TERMS_ACCEPTED_KEY, 'true')
		onAccept()
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>Terms and Conditions</DialogTitle>
					<DialogDescription>Please read and accept our terms and conditions to continue using Plebeian Market.</DialogDescription>
				</DialogHeader>

				<ScrollArea className="flex-1 pr-4 max-h-[60vh]">
					<div className="space-y-6 text-sm">
						<section className="space-y-2">
							<h3 className="font-semibold text-base">User Friendly Summary</h3>
							<ul className="list-disc pl-5 space-y-1 text-muted-foreground">
								<li>
									This Plebeian.Market "Instance" runs on nostr, uses open source software, and follows the laws of England and Wales.
								</li>
								<li>
									Do not list anything illegal, dangerous, or NSFW (for example: drugs, weapons, explicit adult content, counterfeit or
									stolen goods). Alcohol is not allowed yet.
								</li>
								<li>Be respectful. No abuse, harassment, threats, or hate. Admins can remove listings or ban users if needed.</li>
								<li>
									This is a peer-to-peer marketplace with no central customer service. You deal directly with the other person and should
									always act with "buyer beware" in mind.
								</li>
								<li>Reputation and Web of Trust info are only guides. You are responsible for your own decision to buy or sell.</li>
							</ul>
						</section>

						<section className="space-y-2">
							<h3 className="font-semibold text-base">1. Introduction</h3>
							<p className="text-muted-foreground">
								Plebeian.Market is an independent marketplace "Instance" operating on the nostr protocol using the Plebeian App open source
								solution and is governed by the laws of England and Wales.
							</p>
							<p className="text-muted-foreground">
								By accessing, registering with, or using Plebeian.Market (the "Instance"), you agree to be bound by these Terms and
								Conditions.
							</p>
							<p className="text-muted-foreground">
								The listing, sale, distribution, or promotion of illegal, restricted, or Not Safe For Work ("NSFW") items is strictly
								prohibited. This includes, without limitation, drugs, weapons, explicit adult content, counterfeit goods, and any products
								that are unlawful or otherwise restricted under applicable UK law.
							</p>
						</section>

						<section className="space-y-2">
							<h3 className="font-semibold text-base">2. User Conduct and Behaviour</h3>
							<p className="text-muted-foreground">
								Users must treat all other users, including merchants and buyers, with respect, courtesy, and professionalism at all times.
							</p>
							<p className="text-muted-foreground">
								Abusive, harassing, threatening, defamatory, discriminatory, or otherwise inappropriate conduct is strictly prohibited and
								may result in immediate sanctions.
							</p>
						</section>

						<section className="space-y-2">
							<h3 className="font-semibold text-base">3. Legal Compliance and Prohibited Items</h3>
							<p className="text-muted-foreground">
								Users are solely responsible for ensuring that any products they list, sell, or purchase comply with all applicable laws and
								regulations.
							</p>
							<p className="text-muted-foreground">Prohibited items include:</p>
							<ul className="list-disc pl-5 space-y-1 text-muted-foreground">
								<li>Illegal drugs, controlled substances, and associated paraphernalia</li>
								<li>Firearms, weapons, and items designed to cause harm</li>
								<li>Explicit adult or NSFW content and services</li>
								<li>Counterfeit, stolen, or fraudulently obtained goods</li>
							</ul>
						</section>

						<section className="space-y-2">
							<h3 className="font-semibold text-base">4. Peer-to-Peer Nature and User Responsibility</h3>
							<p className="text-muted-foreground">
								Plebeian.Market operates as a peer-to-peer platform. The Instance does not act as an agent, broker, guarantor, or fiduciary
								for any user or transaction.
							</p>
							<p className="text-muted-foreground">
								There is no dedicated customer service or dispute resolution department. All questions, issues, and disputes must be
								addressed directly between the relevant buyer and seller.
							</p>
							<p className="text-muted-foreground">
								Users must adopt a "Buyer Beware" approach and conduct their own due diligence before entering into any transaction.
							</p>
						</section>

						<section className="space-y-2">
							<h3 className="font-semibold text-base">5. Web of Trust, Reputation, and Information</h3>
							<p className="text-muted-foreground">
								The Instance may provide Web of Trust scores, reputation indicators, and other metrics to assist users in evaluating
								merchants and buyers.
							</p>
							<p className="text-muted-foreground">
								Such metrics are provided for informational purposes only and do not constitute a warranty, guarantee, endorsement, or
								recommendation.
							</p>
						</section>

						<section className="space-y-2">
							<h3 className="font-semibold text-base">6. Moderation and Administrative Rights</h3>
							<p className="text-muted-foreground">
								The owners and administrators reserve the right to remove, mute, or ban any user or listing that breaches these Terms,
								applicable law, or community standards.
							</p>
						</section>

						<section className="space-y-2">
							<h3 className="font-semibold text-base">7. Amendments to These Terms</h3>
							<p className="text-muted-foreground">
								Plebeian.Market may amend or update these Terms from time to time. Continued use of the Instance after any amendment
								constitutes acceptance of the updated Terms.
							</p>
						</section>

						<section className="space-y-2">
							<h3 className="font-semibold text-base">8. Acknowledgement and Acceptance</h3>
							<p className="text-muted-foreground">
								By creating an account, adding products, or otherwise using Plebeian.Market, you confirm that you have read and understood
								these Terms and agree to be legally bound by them in full.
							</p>
						</section>
					</div>
				</ScrollArea>

				<DialogFooter className="mt-4">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Decline
					</Button>
					<Button onClick={handleAccept}>I Accept</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

export function hasAcceptedTerms(): boolean {
	return localStorage.getItem(TERMS_ACCEPTED_KEY) === 'true'
}
