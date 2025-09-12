import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { queryOptions } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { defaultRelaysUrls } from '@/lib/constants'

export type ReactionsMap = Record<string, Record<string, number>> // noteId -> emoji -> count

function extractEmojiFromReaction(ev: NDKEvent): string | null {
  try {
    const c = (ev as any)?.content ?? ''
    if (typeof c !== 'string') return null
    let trimmed = c.trim()
    if (!trimmed) return null
    // Map legacy '+' reactions to a plain heart per requirement
    if (trimmed === '+') trimmed = '♥'
    // Most clients put the emoji directly in content. Keep whole string but cap length to avoid spam.
    return trimmed.slice(0, 8)
  } catch {
    return null
  }
}

export const fetchReactionsForNotes = async (noteIds: string[], emoji?: string): Promise<ReactionsMap> => {
  const ndk = ndkActions.getNDK()
  if (!ndk) throw new Error('NDK not initialized')
  if (!Array.isArray(noteIds) || noteIds.length === 0) return {}

  const relaySet = NDKRelaySet.fromRelayUrls(defaultRelaysUrls, ndk)

  const nowSec = Math.floor(Date.now() / 1000)
  const oneMonthAgoSec = nowSec - 60 * 60 * 24 * 31 // ~last month

  const filter: NDKFilter = {
    kinds: [7 as any],
    limit: 2000,
    since: oneMonthAgoSec,
  }
  ;(filter as any)['#e'] = noteIds

  const events = await ndk.fetchEvents(filter, undefined, relaySet)
  const arr = Array.from(events)

  const map: ReactionsMap = {}
  for (const ev of arr) {
    const eTags = (ev as any)?.tags?.filter((t: any) => Array.isArray(t) && t[0] === 'e' && typeof t[1] === 'string') || []
    const targetId: string | undefined = eTags[0]?.[1]
    if (!targetId) continue
    const em = extractEmojiFromReaction(ev)
    if (!em) continue
    if (emoji && em !== emoji) continue
    if (!map[targetId]) map[targetId] = {}
    map[targetId][em] = (map[targetId][em] || 0) + 1
  }
  return map
}

export const reactionsQueryOptions = (noteIds: string[], emoji?: string) =>
  queryOptions({
    queryKey: ['reactions', noteIds.slice().sort().join(','), emoji || ''],
    queryFn: () => fetchReactionsForNotes(noteIds, emoji),
    staleTime: 10_000,
    enabled: noteIds.length > 0,
  })
