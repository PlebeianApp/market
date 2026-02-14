import { QueryClient } from '@tanstack/react-query'

// NDK, auth, and wallet initialization moved to frontend.tsx
// so it happens AFTER config is loaded (stage/relay selection depends on config).
export function createQueryClient(): QueryClient {
	return new QueryClient()
}
