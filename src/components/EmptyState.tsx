import { type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-5">
        <Icon className="w-10 h-10 text-primary/50" />
      </div>
      <h3 className="text-lg font-medium mb-1.5">{title}</h3>
      {description && (
        <p className="text-muted-foreground text-sm max-w-sm">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-5" variant="outline">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
