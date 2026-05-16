import { Button } from "@/components/ui/button";
import { X, Mic, MicOff, Video, VideoOff, Monitor } from "lucide-react";

interface Participant {
  id: string;
  user_id: string;
  user_name: string;
  is_muted: boolean;
  is_video_on: boolean;
  is_screen_sharing: boolean;
}

interface ParticipantsListProps {
  participants: Participant[];
  userId: string;
  onClose: () => void;
}

const ParticipantsList = ({ participants, userId, onClose }: ParticipantsListProps) => {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 sm:p-4 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold text-foreground text-sm">משתתפים</h3>
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8"
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="space-y-2">
          {participants.map((p) => (
            <div key={p.id} className="flex items-center gap-2 sm:gap-3 p-2 rounded-lg hover:bg-secondary/50">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full gradient-primary flex items-center justify-center text-xs sm:text-sm font-bold text-primary-foreground shrink-0">
                {p.user_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-medium text-foreground truncate">
                  {p.user_name}
                  {p.user_id === userId && ' (את/ה)'}
                </p>
                <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground">
                  {p.is_screen_sharing && (
                    <span className="flex items-center gap-1 text-primary">
                      <Monitor className="w-3 h-3" /> משתף מסך
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {p.is_muted ? (
                  <MicOff className="w-3 h-3 sm:w-4 sm:h-4 text-destructive" />
                ) : (
                  <Mic className="w-3 h-3 sm:w-4 sm:h-4 text-green-500" />
                )}
                {p.is_video_on ? (
                  <Video className="w-3 h-3 sm:w-4 sm:h-4 text-green-500" />
                ) : (
                  <VideoOff className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ParticipantsList;
