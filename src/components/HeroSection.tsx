import { Video, Users, Globe } from "lucide-react";
import CreateRoomDialog from "./CreateRoomDialog";

interface HeroSectionProps {
  onCreateRoom: (room: {
    name: string;
    description?: string;
    category: string;
    max_participants: number;
    is_locked: boolean;
    host_name: string;
  }) => Promise<any>;
  totalRooms: number;
  totalParticipants: number;
  userName: string;
}

const HeroSection = ({ onCreateRoom, totalRooms, totalParticipants, userName }: HeroSectionProps) => {
  return (
    <section className="relative py-16 md:py-24 overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 gradient-glow opacity-50" />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-sm text-muted-foreground mb-6 animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-online animate-pulse" />
            <span>{totalParticipants} משתתפים פעילים עכשיו</span>
          </div>
          
          <h1 className="text-4xl md:text-6xl font-bold mb-6 animate-slide-up">
            חדרי פגישות
            <br />
            <span className="text-gradient">זמינים תמיד</span>
          </h1>
          
          <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto animate-fade-in">
            הצטרפות לחדרים קיימים או יצירת חדר חדש.
            פגישות וירטואליות פתוחות 24/7 עם וידאו ושיתוף מסך.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <CreateRoomDialog onCreateRoom={onCreateRoom} userName={userName} />
          </div>

          <div className="grid grid-cols-3 gap-6 max-w-md mx-auto">
            <div className="glass rounded-xl p-4 animate-slide-up" style={{ animationDelay: '0.1s' }}>
              <Video className="w-6 h-6 text-primary mx-auto mb-2" />
              <div className="text-2xl font-bold text-foreground">{totalRooms}</div>
              <div className="text-xs text-muted-foreground">חדרים פעילים</div>
            </div>
            <div className="glass rounded-xl p-4 animate-slide-up" style={{ animationDelay: '0.2s' }}>
              <Users className="w-6 h-6 text-primary mx-auto mb-2" />
              <div className="text-2xl font-bold text-foreground">{totalParticipants}</div>
              <div className="text-xs text-muted-foreground">משתתפים</div>
            </div>
            <div className="glass rounded-xl p-4 animate-slide-up" style={{ animationDelay: '0.3s' }}>
              <Globe className="w-6 h-6 text-primary mx-auto mb-2" />
              <div className="text-2xl font-bold text-foreground">24/7</div>
              <div className="text-xs text-muted-foreground">זמינות</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
