import { Room } from "@/hooks/useRooms";
import { Users, Lock, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const categoryLabels: Record<string, string> = {
  meeting: "פגישה",
  social: "חברתי",
  work: "עבודה",
  education: "לימודים",
};

const categoryColors: Record<string, string> = {
  meeting: "bg-blue-500/20 text-blue-400",
  social: "bg-pink-500/20 text-pink-400",
  work: "bg-amber-500/20 text-amber-400",
  education: "bg-green-500/20 text-green-400",
};

interface RoomCardProps {
  room: Room;
  onJoin: (roomId: string) => void;
}

const RoomCard = ({ room, onJoin }: RoomCardProps) => {
  const isFull = (room.participants_count || 0) >= room.max_participants;
  const participantCount = room.participants_count || 0;

  return (
    <div className="glass rounded-2xl p-6 animate-slide-up hover:scale-[1.02] transition-all duration-300 group">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-lg shadow-glow">
            {room.host_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-lg group-hover:text-primary transition-colors">
              {room.name}
            </h3>
            <p className="text-sm text-muted-foreground">{room.host_name}</p>
          </div>
        </div>
        {room.is_locked && (
          <div className="p-2 rounded-lg bg-muted">
            <Lock className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
      </div>

      <p className="text-muted-foreground text-sm mb-4 line-clamp-2">
        {room.description || 'חדר פגישות וירטואלי'}
      </p>

      <div className="flex items-center justify-between mb-4">
        <span className={cn("px-3 py-1 rounded-full text-xs font-medium", categoryColors[room.category] || categoryColors.meeting)}>
          {categoryLabels[room.category] || categoryLabels.meeting}
        </span>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Users className="w-4 h-4" />
          <span className="text-sm">
            {participantCount}/{room.max_participants}
          </span>
          {participantCount > 0 && (
            <span className="w-2 h-2 rounded-full bg-online animate-pulse" />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 min-w-0">
        <div className="flex -space-x-2 flex-1 min-w-0 overflow-hidden">
          {[...Array(Math.min(participantCount, 4))].map((_, i) => (
            <div
              key={i}
              className="w-8 h-8 rounded-full bg-secondary border-2 border-card flex items-center justify-center text-xs text-muted-foreground shrink-0"
            >
              {String.fromCharCode(65 + i)}
            </div>
          ))}
          {participantCount > 4 && (
            <div className="w-8 h-8 rounded-full bg-muted border-2 border-card flex items-center justify-center text-xs text-muted-foreground shrink-0">
              +{participantCount - 4}
            </div>
          )}
        </div>
        <Button
          onClick={() => onJoin(room.id)}
          disabled={isFull || room.is_locked}
          variant={isFull ? "secondary" : "default"}
          size="sm"
          className="gap-2 shrink-0"
        >
          <Video className="w-4 h-4" />
          <span className="hidden sm:inline">{isFull ? "מלא" : room.is_locked ? "נעול" : "הצטרף"}</span>
          <span className="sm:hidden">{isFull ? "מלא" : room.is_locked ? "נעול" : "היכנס"}</span>
        </Button>
      </div>
    </div>
  );
};

export default RoomCard;
