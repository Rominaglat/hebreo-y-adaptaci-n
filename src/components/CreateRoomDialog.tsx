import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Video, Loader2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

const categoryLabels: Record<string, string> = {
  meeting: "פגישה",
  social: "חברתי",
  work: "עבודה",
  education: "לימודים",
};

interface CreateRoomDialogProps {
  onCreateRoom: (room: {
    name: string;
    description?: string;
    category: string;
    max_participants: number;
    is_locked: boolean;
    host_name: string;
  }) => Promise<any>;
  userName: string;
}

const CreateRoomDialog = ({ onCreateRoom, userName }: CreateRoomDialogProps) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("meeting");
  const [maxParticipants, setMaxParticipants] = useState("10");
  const [isLocked, setIsLocked] = useState(false);
  const isMobile = useIsMobile();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      await onCreateRoom({
        name,
        description: description || undefined,
        category,
        max_participants: parseInt(maxParticipants),
        is_locked: isLocked,
        host_name: userName,
      });
      
      setOpen(false);
      setName("");
      setDescription("");
      setCategory("meeting");
      setMaxParticipants("10");
      setIsLocked(false);
    } catch (error) {
      console.error('Error creating room:', error);
    } finally {
      setLoading(false);
    }
  };

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">שם החדר</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="הכנס שם לחדר..."
          className="bg-secondary border-border"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">תיאור</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="תאר במה מדובר..."
          className="bg-secondary border-border resize-none"
          rows={3}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>קטגוריה</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="bg-secondary border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background border-border z-[100]">
              {Object.entries(categoryLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="max">מקסימום משתתפים</Label>
          <Input
            id="max"
            type="number"
            min="2"
            max="50"
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(e.target.value)}
            className="bg-secondary border-border"
          />
        </div>
      </div>
      <div className="flex items-center justify-between py-2">
        <Label htmlFor="locked" className="cursor-pointer">חדר פרטי (נעול)</Label>
        <Switch
          id="locked"
          checked={isLocked}
          onCheckedChange={setIsLocked}
        />
      </div>
      <Button type="submit" variant="hero" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            בתהליך יצירת חדר...
          </>
        ) : (
          'יצירת חדר'
        )}
      </Button>
    </form>
  );

  const triggerButton = (
    <Button variant="hero" size="lg" className="gap-2">
      <Plus className="w-5 h-5" />
      יצירת חדר חדש
    </Button>
  );

  const headerContent = (
    <div className="flex items-center gap-2">
      <Video className="w-6 h-6 text-primary" />
      יצירת חדר חדש
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          {triggerButton}
        </DrawerTrigger>
        <DrawerContent className="px-4 pb-6">
          <DrawerHeader className="text-right">
            <DrawerTitle className="text-xl font-bold flex items-center justify-end gap-2">
              {headerContent}
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 max-h-[70vh] overflow-y-auto">
            {formContent}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton}
      </DialogTrigger>
      <DialogContent className="glass border-border w-[95vw] max-w-md mx-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            {headerContent}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-4">
          {formContent}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateRoomDialog;
