import { useState, useMemo, useEffect } from "react";
import { useRooms, Room } from "@/hooks/useRooms";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import CategoryFilter from "@/components/CategoryFilter";
import RoomCard from "@/components/RoomCard";
import MeetingRoom from "@/components/MeetingRoom";
import UserNameDialog from "@/components/UserNameDialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const Index = () => {
  const { toast } = useToast();
  const { rooms, loading, createRoom } = useRooms();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | 'all'>('all');
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [showNameDialog, setShowNameDialog] = useState(false);

  // Generate or retrieve user ID
  useEffect(() => {
    const storedUserId = localStorage.getItem('roomhub_user_id');
    const storedUserName = localStorage.getItem('roomhub_user_name');
    
    if (storedUserId) {
      setUserId(storedUserId);
    } else {
      const newUserId = crypto.randomUUID();
      localStorage.setItem('roomhub_user_id', newUserId);
      setUserId(newUserId);
    }

    if (storedUserName) {
      setUserName(storedUserName);
    } else {
      setShowNameDialog(true);
    }

    // Check for room ID in URL
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    if (roomId && storedUserName) {
      // Join room from URL
      const room = rooms.find(r => r.id === roomId);
      if (room) {
        setActiveRoom(room);
      }
    }
  }, [rooms]);

  const handleSetUserName = (name: string) => {
    setUserName(name);
    localStorage.setItem('roomhub_user_name', name);
    setShowNameDialog(false);
  };

  const filteredRooms = useMemo(() => {
    return rooms.filter((room) => {
      const matchesSearch = room.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (room.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
      const matchesCategory = selectedCategory === 'all' || room.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [rooms, searchQuery, selectedCategory]);

  const totalParticipants = useMemo(() => {
    return rooms.reduce((sum, room) => sum + (room.participants_count || 0), 0);
  }, [rooms]);

  const handleCreateRoom = async (newRoomData: {
    name: string;
    description?: string;
    category: string;
    max_participants: number;
    is_locked: boolean;
    host_name: string;
  }) => {
    const room = await createRoom(newRoomData);
    setActiveRoom(room);
    toast({
      title: "החדר נוצר בהצלחה!",
      description: `הצטרפת לחדר "${room.name}"`,
    });
    return room;
  };

  const handleJoinRoom = (roomId: string) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      setActiveRoom(room);
      toast({
        title: "הצטרפות לחדר",
        description: `ברוכים הבאים ל-"${room.name}"`,
      });
    }
  };

  const handleLeaveRoom = () => {
    if (activeRoom) {
      toast({
        title: "יציאה מהחדר",
        description: `יצאת מ-"${activeRoom.name}"`,
      });
    }
    setActiveRoom(null);
    // Clear room from URL
    window.history.replaceState({}, '', window.location.pathname);
  };

  if (activeRoom && userName && userId) {
    return (
      <MeetingRoom 
        room={activeRoom} 
        onLeave={handleLeaveRoom}
        userId={userId}
        userName={userName}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <UserNameDialog open={showNameDialog} onSubmit={handleSetUserName} />
      
      <Header searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      
      <HeroSection 
        onCreateRoom={handleCreateRoom}
        totalRooms={rooms.length}
        totalParticipants={totalParticipants}
        userName={userName}
      />

      <section className="container mx-auto px-4 pb-16">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-foreground">חדרים פעילים</h2>
        </div>

        <CategoryFilter 
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
        />

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-lg">לא נמצאו חדרים מתאימים</p>
            <p className="text-muted-foreground text-sm mt-2">אפשר לחפש משהו אחר או ליצור חדר חדש</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredRooms.map((room) => (
              <RoomCard key={room.id} room={room} onJoin={handleJoinRoom} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default Index;
