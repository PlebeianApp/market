import { uiActions, uiStore } from '@/lib/stores/ui'
import { useStore } from '@tanstack/react-store'

export function Footer() {
	const { showNSFWContent } = useStore(uiStore)

	const handleNSFWToggle = () => {
		if (showNSFWContent) {
			uiActions.disableNSFWContent()
		} else {
			uiActions.openNSFWConfirmation()
		}
	}

	return (
		<footer className="sticky top-0 bg-black p-4 font-bold text-white lg:px-12 flex justify-center">
			<div className="container flex justify-between items-center flex-col gap-4 md:gap-0 md:flex-row">
				<div className="flex gap-4 flex-col md:flex-row items-center">
					<span>Plug into the bitcoin economy. Powered by Nostr.</span>
					<div className="flex gap-4">
						<a className="underline" href="/faqs">
							FAQ
						</a>
						<button onClick={handleNSFWToggle} className="underline hover:text-secondary transition-colors">
							Adult content: {showNSFWContent ? 'On' : 'Off'}
						</button>
					</div>
				</div>
				<div className="text-right flex justify-between items-center gap-6">
					<a
						className="border-none hover:bg-secondary p-1 inline-flex justify-center items-center"
						href="https://njump.me/npub1market6g3zl4mxwx5ugw56hfg0f7dy7jnnw8t380788mvdyrnwuqgep7hd"
						target="_blank"
						rel="noopener noreferrer"
					>
						<img src="/images/ostrich.svg" alt="Ostrich" className="h-6 w-6" />
					</a>
					<a
						href="https://twitter.com/PlebeianMarket"
						className="border-none hover:bg-secondary p-1 inline-flex justify-center items-center"
						target="_blank"
						rel="noopener noreferrer"
					>
						<img src="/images/x.svg" alt="X" className="h-6 w-6" style={{ filter: 'invert(1)' }} />
					</a>
					<a
						className="border-none hover:bg-secondary p-1 inline-flex justify-center items-center"
						href="https://plebeianmarket.substack.com/"
						target="_blank"
						rel="noopener noreferrer"
					>
						<img src="/images/substack-icon.svg" alt="Substack" className="h-6 w-6" style={{ filter: 'brightness(0) invert(1)' }} />
					</a>
					<a
						className="border-none hover:bg-secondary p-1 inline-flex justify-center items-center"
						href="https://t.me/PlebeianMarket"
						target="_blank"
						rel="noopener noreferrer"
					>
						<img src="/images/telegram.svg" alt="Telegram" className="h-6 w-6" style={{ filter: 'invert(1)' }} />
					</a>
					<a
						className="border-none hover:bg-secondary p-1 inline-flex justify-center items-center"
						href="https://github.com/PlebeianTech/plebeian.market"
						target="_blank"
						rel="noopener noreferrer"
					>
						<img src="/images/github.svg" alt="GitHub" className="h-6 w-6" style={{ filter: 'invert(1)' }} />
					</a>
				</div>
			</div>
		</footer>
	)
}
