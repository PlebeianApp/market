import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface UserDisplayProps {
  pubkey?: string
}

export function UserDisplay({ pubkey }: UserDisplayProps) {
  return (
    <div className="flex items-center gap-2">
      <Avatar className="h-8 w-8">
        <AvatarImage src={''} />
        <AvatarFallback>{pubkey ? pubkey.substring(0, 2).toUpperCase() : '??'}</AvatarFallback>
      </Avatar>
      <span className="text-xs truncate w-24">{pubkey ? `${pubkey.substring(0, 8)}...` : 'Unknown'}</span>
    </div>
  )
} 