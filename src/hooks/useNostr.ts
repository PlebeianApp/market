import { useRouter } from '@tanstack/react-router'

export function useNostr() {
	const { nostr } = useRouter().context
	return nostr
}
