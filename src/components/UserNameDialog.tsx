import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User } from "lucide-react";

interface UserNameDialogProps {
  open: boolean;
  onSubmit: (name: string) => void;
}

const UserNameDialog = ({ open, onSubmit }: UserNameDialogProps) => {
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim());
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="glass border-border sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <User className="w-6 h-6 text-primary" />
            ברוכים הבאים ל-RoomHub
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="userName">מה שמך?</Label>
            <Input
              id="userName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="הזנת שם..."
              className="bg-secondary border-border"
              autoFocus
              required
            />
          </div>
          <p className="text-sm text-muted-foreground">
            השם שלך יוצג לאחרים בחדרי הפגישות
          </p>
          <Button type="submit" variant="hero" className="w-full" disabled={!name.trim()}>
            התחלה
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default UserNameDialog;
