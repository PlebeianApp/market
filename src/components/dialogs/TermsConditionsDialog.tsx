import { useConfigQuery } from '@/queries/config'
import { TermsConditionsDialogView } from '@ui/components/dialogs/TermsConditionsDialogView'

export const TERMS_ACCEPTED_KEY = 'plebeian_terms_accepted'

interface TermsConditionsDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onAccept: () => void
}

export function TermsConditionsDialog({ open, onOpenChange, onAccept }: TermsConditionsDialogProps) {
	const { data: config } = useConfigQuery()

	return (
		<TermsConditionsDialogView
			open={open}
			instanceName={config?.displayName || config?.name || 'Marketplace'}
			termsUrl={config?.termsUrl}
			onAccept={() => {
				localStorage.setItem(TERMS_ACCEPTED_KEY, 'true')
				onAccept()
				onOpenChange(false)
			}}
		/>
	)
}

export function hasAcceptedTerms(): boolean {
	return localStorage.getItem(TERMS_ACCEPTED_KEY) === 'true'
}
