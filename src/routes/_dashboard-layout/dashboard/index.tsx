import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useOrders } from '@/queries/orders'
import { getOrderStatus, formatSats, getEventDate, getOrderAmount, getOrderId } from '@/queries/orders'
import { ORDER_STATUS } from '@/lib/schemas/order'
import { useConversationsList } from '@/queries/messages'
import { postsQueryOptions } from '@/queries/posts'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/')({
	loader: () => {
		throw redirect({ to: '/dashboard/dashboard' })
	},
})

function DashboardInnerComponent() { return null }
