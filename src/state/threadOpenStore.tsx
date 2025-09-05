import { createContext, useContext, useMemo, useState } from 'react'

// Minimal global store to ensure only one thread is open at a time across NoteView instances

type ThreadOpenContextValue = {
  openThreadId: string | null
  setOpenThreadId: (id: string | null) => void
}

const ThreadOpenContext = createContext<ThreadOpenContextValue | null>(null)

export function ThreadOpenProvider({ children }: { children: React.ReactNode }) {
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const value = useMemo(() => ({ openThreadId, setOpenThreadId }), [openThreadId])
  return <ThreadOpenContext.Provider value={value}>{children}</ThreadOpenContext.Provider>
}

export function useThreadOpen() {
  const ctx = useContext(ThreadOpenContext)
  if (!ctx) {
    throw new Error('useThreadOpen must be used within a ThreadOpenProvider')
  }
  return ctx
}
