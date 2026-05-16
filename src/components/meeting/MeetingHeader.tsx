import { Button } from "@/components/ui/button";
import { Video, Copy, Check } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface MeetingHeaderProps {
  roomName: string;
  roomId: string;
  participantCount: number;
}

const MeetingHeader = ({ roomName, roomId, participantCount }: MeetingHeaderProps) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copyRoomLink = () => {
    navigator.clipboard.writeText(window.location.href + '?room=' + roomId);
    setCopied(true);
    toast({
      title: "הקישור הועתק!",
      description: "שתף את הקישור עם אחרים להזמנה לחדר",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="glass h-12 sm:h-14 px-2 sm:px-4 flex items-center justify-between border-b border-border shrink-0">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg gradient-primary flex items-center justify-center shrink-0">
          <Video className="w-3 h-3 sm:w-4 sm:h-4 text-primary-foreground" />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold text-foreground text-xs sm:text-sm truncate">{roomName}</h2>
          <p className="text-[10px] sm:text-xs text-muted-foreground">{participantCount} משתתפים</p>
        </div>
      </div>
      <Button 
        variant="glass" 
        size="sm" 
        className="gap-1 sm:gap-2 text-xs sm:text-sm shrink-0"
        onClick={copyRoomLink}
      >
        {copied ? <Check className="w-3 h-3 sm:w-4 sm:h-4" /> : <Copy className="w-3 h-3 sm:w-4 sm:h-4" />}
        <span className="hidden sm:inline">הזמנת אחרים</span>
      </Button>
    </header>
  );
};

export default MeetingHeader;
