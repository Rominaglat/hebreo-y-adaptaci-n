import { Video, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

const Header = ({ searchQuery, onSearchChange }: HeaderProps) => {
  return (
    <header className="glass sticky top-0 z-50 border-b border-border">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-glow">
            <Video className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold text-foreground hidden sm:block">
            Room<span className="text-gradient">Hub</span>
          </span>
        </div>

        <div className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="חפש חדרים..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pr-10 bg-secondary border-border"
            />
          </div>
        </div>

        <Button variant="glass" size="sm">
          הכנס
        </Button>
      </div>
    </header>
  );
};

export default Header;
