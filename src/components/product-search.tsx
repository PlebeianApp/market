import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'

export function ProductSearch() {
  const [search, setSearch] = useState('')
  const [showResults, setShowResults] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  
  const handleFocus = () => {
    setShowResults(true)
  }

  const clearSearch = () => {
    setSearch('')
    setShowResults(false)
  }

  // Handle clicks outside the search container
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // TODO: Add actual search functionality later

  return (
    <div className="relative w-full" ref={searchContainerRef}>
      <Input
        type="search"
        placeholder="Search Products"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={handleFocus}
        className="px-4 w-full text-md bg-primary text-white border-none focus-visible:ring-offset-0 focus:ring-2 focus:ring-secondary rounded-[999px] [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
      />
      
      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-2">
        {search ? (
          <button
            onClick={clearSearch}
            className="text-white/50 hover:text-white transition-colors"
          >
            <span className="i-close w-5 h-5 text-secondary" />
          </button>
        ) : (
          <span className="i-search w-5 h-5 text-secondary" />
        )}
      </div>

      {showResults && (
        <div className="p-2 flex flex-col gap-2 absolute top-full mt-2 bg-[#1c1c1c] rounded-lg shadow-lg w-full lg:w-[480px] lg:left-auto lg:right-0 z-40">
          <div className="p-4 text-center text-white">
            {search.trim() ? 'Searching...' : 'No products available'}
          </div>
        </div>
      )}
    </div>
  )
} 