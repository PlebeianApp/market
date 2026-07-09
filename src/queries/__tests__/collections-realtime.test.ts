import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCollections, useCollectionsByPubkey } from '../collections'
import { ndkActions } from '@/lib/stores/ndk'

// Mock NDK and dependencies
vi.mock('@/lib/stores/ndk', () => ({
  ndkActions: {
    getNDK: vi.fn(),
    getRelaySet: vi.fn(),
  },
}))

vi.mock('@/lib/stores/auth', () => ({
  authStore: {
    getState: vi.fn(),
  },
}))

// Mock NDK classes
const mockNDK = {
  subscribe: vi.fn(),
}

const mockSubscription = {
  on: vi.fn(),
  stop: vi.fn(),
}

const mockEvent = {
  id: 'test-event-id',
  pubkey: 'test-pubkey',
  created_at: Date.now() / 1000,
  kind: 30405,
  tags: [],
  content: '',
}

describe('Collections Real-time Subscriptions', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    vi.clearAllMocks()
    
    // Setup NDK mocks
    vi.mocked(ndkActions.getNDK).mockReturnValue(mockNDK)
    vi.mocked(ndkActions.getRelaySet).mockReturnValue({})
    
    mockNDK.subscribe.mockReturnValue(mockSubscription)
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )

  describe('useCollections', () => {
    it('should create subscription with closeOnEose: false', () => {
      const { result } = renderHook(() => useCollections(), { wrapper })

      expect(mockNDK.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          kinds: [30405],
          limit: 50,
        }),
        expect.objectContaining({
          closeOnEose: false,
          relaySet: {},
          exclusiveRelay: true,
        })
      )
    })

    it('should set up event handler to invalidate queries', () => {
      const { result } = renderHook(() => useCollections(), { wrapper })

      // Check that subscription.on was called for 'event'
      expect(mockSubscription.on).toHaveBeenCalledWith('event', expect.any(Function))
      
      // Get the event handler
      const eventHandler = vi.mocked(mockSubscription.on).mock.calls.find(
        call => call[0] === 'event'
      )?.[1]

      if (eventHandler) {
        // Simulate receiving an event after EOSE
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
        
        // Call the event handler
        eventHandler(mockEvent)
        
        // Should not invalidate before EOSE
        expect(invalidateSpy).not.toHaveBeenCalled()
      }
    })

    it('should clean up subscription on unmount', () => {
      const { unmount } = renderHook(() => useCollections(), { wrapper })

      unmount()

      expect(mockSubscription.stop).toHaveBeenCalled()
    })
  })

  describe('useCollectionsByPubkey', () => {
    it('should create subscription with author filter', () => {
      const pubkey = 'test-pubkey'
      const { result } = renderHook(() => useCollectionsByPubkey(pubkey), { wrapper })

      expect(mockNDK.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          kinds: [30405],
          authors: [pubkey],
          limit: 50,
        }),
        expect.objectContaining({
          closeOnEose: false,
          relaySet: {},
          exclusiveRelay: true,
        })
      )
    })

    it('should not create subscription when pubkey is empty', () => {
      const { result } = renderHook(() => useCollectionsByPubkey(''), { wrapper })

      expect(mockNDK.subscribe).not.toHaveBeenCalled()
    })
  })
})