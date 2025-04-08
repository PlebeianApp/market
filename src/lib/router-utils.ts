import { QueryClient } from '@tanstack/react-query'

// Define router context type for the application
export interface AppRouterContext {
	queryClient: QueryClient
}

// Type assertion helper for route loaders
export function getQueryClient(context: any): QueryClient {
	return (context as AppRouterContext).queryClient
}
