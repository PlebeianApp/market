import { useState, useCallback, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { bugReportsQueryOptions, type BugReport } from '@/queries/bugReports'

interface UseBugReportsInfiniteScrollOptions {
	chunkSize?: number
	maxReports?: number
	threshold?: number
	autoLoad?: boolean
}

interface UseBugReportsInfiniteScrollReturn {
	reports: BugReport[]
	hasMore: boolean
	isLoading: boolean
	isError: boolean
	error: Error | null
	loadMore: () => void
	totalReports: number
	currentChunk: number
	totalChunks: number
}

/**
 * Infinite scroll hook for bug reports that fetches all reports at once and displays them in chunks
 */
export const useBugReportsInfiniteScroll = ({
	chunkSize = 20,
	maxReports = 500,
	threshold = 1000,
	autoLoad = true,
}: UseBugReportsInfiniteScrollOptions = {}): UseBugReportsInfiniteScrollReturn => {
	// Fetch all reports at once
	const { data: allReports = [], isLoading, isError, error } = useQuery(bugReportsQueryOptions(maxReports))

	// Track current chunk (page)
	const [currentChunk, setCurrentChunk] = useState(1)

	// Calculate visible reports based on current chunk
	const reports = useMemo(() => {
		const endIndex = currentChunk * chunkSize
		return allReports.slice(0, endIndex)
	}, [allReports, currentChunk, chunkSize])

	// Calculate if there are more reports to load
	const hasMore = useMemo(() => {
		return reports.length < allReports.length
	}, [reports.length, allReports.length])

	// Calculate total chunks
	const totalChunks = useMemo(() => {
		return Math.ceil(allReports.length / chunkSize)
	}, [allReports.length, chunkSize])

	// Load more function
	const loadMore = useCallback(() => {
		if (hasMore && !isLoading) {
			setCurrentChunk((prev) => prev + 1)
		}
	}, [hasMore, isLoading])

	// Auto-load on scroll
	useEffect(() => {
		if (!autoLoad) return

		const handleScroll = () => {
			const scrollTop = window.pageYOffset || document.documentElement.scrollTop
			const scrollHeight = document.documentElement.scrollHeight
			const clientHeight = window.innerHeight
			const distanceFromBottom = scrollHeight - scrollTop - clientHeight

			if (distanceFromBottom <= threshold && hasMore && !isLoading) {
				loadMore()
			}
		}

		window.addEventListener('scroll', handleScroll, { passive: true })
		return () => window.removeEventListener('scroll', handleScroll)
	}, [autoLoad, threshold, hasMore, isLoading, loadMore])

	return {
		reports,
		hasMore,
		isLoading,
		isError,
		error,
		loadMore,
		totalReports: allReports.length,
		currentChunk,
		totalChunks,
	}
}
