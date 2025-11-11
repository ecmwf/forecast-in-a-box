import { createFileRoute } from '@tanstack/react-router'
import { StatusCard } from '@/features/status/components/StatusCard'

export const Route = createFileRoute('/')({
  component: App,
})

function App() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <StatusCard />
    </div>
  )
}
