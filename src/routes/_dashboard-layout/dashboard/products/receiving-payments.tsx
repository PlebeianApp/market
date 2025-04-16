import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/receiving-payments')({
  component: ReceivingPaymentsComponent,
})

function ReceivingPaymentsComponent() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Receiving Payments</h1>
      <p>Manage your payment receiving options here</p>
    </div>
  )
} 