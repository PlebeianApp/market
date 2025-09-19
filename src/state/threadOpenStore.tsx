import { createContext, useContext, useMemo, useState, useEffect } from 'react'

// Minimal global store to ensure only one thread is open at a time across NoteView instances

type ThreadOpenContextValue = {
  openThreadId: string | null
  setOpenThreadId: (id: string | null) => void
  feedScrollY: number | null
  setFeedScrollY: (y: number | null) => void
  clickedEventId: string | null
  setClickedEventId: (id: string | null) => void
}

const LAST_CLICKED_EVENT_STORAGE_KEY = 'nostr_last_clicked_event'

const ThreadOpenContext = createContext<ThreadOpenContextValue | null>(null)

export function ThreadOpenProvider({ children }: { children: React.ReactNode }) {
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const [feedScrollY, setFeedScrollY] = useState<number | null>(null)
  // Initialize from localStorage if available
  const [clickedEventId, setClickedEventId] = useState<string | null>(() => {
    try {
      if (typeof window === 'undefined') return null
      const v = window.localStorage.getItem(LAST_CLICKED_EVENT_STORAGE_KEY)
      return v ? v : null
    } catch {
      return null
    }
  })

  // Persist clickedEventId whenever it changes
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return
      if (clickedEventId) {
        window.localStorage.setItem(LAST_CLICKED_EVENT_STORAGE_KEY, clickedEventId)
      } else {
        window.localStorage.removeItem(LAST_CLICKED_EVENT_STORAGE_KEY)
      }
    } catch {}
  }, [clickedEventId])

  const value = useMemo(() => ({ openThreadId, setOpenThreadId, feedScrollY, setFeedScrollY, clickedEventId, setClickedEventId }), [openThreadId, feedScrollY, clickedEventId])
  return <ThreadOpenContext.Provider value={value}>{children}</ThreadOpenContext.Provider>
}

export function useThreadOpen() {
  const ctx = useContext(ThreadOpenContext)
  if (!ctx) {
    throw new Error('useThreadOpen must be used within a ThreadOpenProvider')
  }
  return ctx
}
