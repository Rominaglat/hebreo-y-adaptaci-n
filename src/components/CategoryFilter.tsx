import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const categoryLabels: Record<string, string> = {
  meeting: "פגישה",
  social: "חברתי",
  work: "עבודה",
  education: "לימודים",
};

const categoryColors: Record<string, string> = {
  meeting: "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30",
  social: "bg-pink-500/20 text-pink-400 hover:bg-pink-500/30",
  work: "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30",
  education: "bg-green-500/20 text-green-400 hover:bg-green-500/30",
};

interface CategoryFilterProps {
  selectedCategory: string | 'all';
  onCategoryChange: (category: string | 'all') => void;
}

const CategoryFilter = ({ selectedCategory, onCategoryChange }: CategoryFilterProps) => {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-8">
      <Button
        variant={selectedCategory === 'all' ? 'default' : 'secondary'}
        size="sm"
        onClick={() => onCategoryChange('all')}
        className="rounded-full"
      >
        הכל
      </Button>
      {Object.entries(categoryLabels).map(([key, label]) => (
        <Button
          key={key}
          variant={selectedCategory === key ? 'default' : 'secondary'}
          size="sm"
          onClick={() => onCategoryChange(key)}
          className={cn(
            "rounded-full",
            selectedCategory !== key && categoryColors[key]
          )}
        >
          {label}
        </Button>
      ))}
    </div>
  );
};

export default CategoryFilter;
