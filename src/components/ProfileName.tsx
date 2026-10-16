import { useProfileName } from '@/queries/profiles'
import { formatPubkeyShort } from '@sdk/core/nostr/pubkeyDisplay'
import { ProfileNameView } from '@ui/components/ProfileViews'

interface ProfileNameProps extends React.HTMLAttributes<HTMLSpanElement> {
	pubkey: string
	truncate?: boolean
	disableLink?: boolean
}

export function ProfileName({ pubkey, ...props }: ProfileNameProps) {
	const { data: name, isLoading } = useProfileName(pubkey)
	return <ProfileNameView pubkey={pubkey} name={name} fallbackLabel={formatPubkeyShort(pubkey)} isLoading={isLoading} {...props} />
}
