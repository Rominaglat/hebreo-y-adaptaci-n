import { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SkillRatingProps {
  value: number;
  onChange?: (rating: number) => void;
  readonly?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
};

export function SkillRating({ value, onChange, readonly = false, size = 'md' }: SkillRatingProps) {
  const [hovered, setHovered] = useState(0);

  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => !readonly && setHovered(0)}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = hovered ? star <= hovered : star <= value;
        return (
          <button
            key={star}
            type="button"
            disabled={readonly}
            className={cn(
              'transition-colors',
              readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'
            )}
            onMouseEnter={() => !readonly && setHovered(star)}
            onClick={() => onChange?.(star)}
          >
            <Star
              className={cn(
                sizeMap[size],
                filled ? 'fill-amber-400 text-amber-400' : 'text-gray-300 dark:text-gray-600'
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
