import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { differenceInDays } from 'date-fns';

interface NewBadgeProps {
  createdAt: string | Date;
  className?: string;
}

/**
 * Shows a "New" badge if the item was created within the last 7 days
 */
export function NewBadge({ createdAt, className }: NewBadgeProps) {
  const { t } = useLanguage();

  const createdDate = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const daysSinceCreation = differenceInDays(new Date(), createdDate);

  if (daysSinceCreation > 7) {
    return null;
  }

  return (
    <Badge
      variant="default"
      className={`bg-success hover:bg-success text-success-foreground text-[10px] px-1.5 py-0 h-4 ${className}`}
    >
      {t('badge.new')}
    </Badge>
  );
}

/**
 * Check if an item is "new" (created within last 7 days)
 */
export function isNew(createdAt: string | Date): boolean {
  const createdDate = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const daysSinceCreation = differenceInDays(new Date(), createdDate);
  return daysSinceCreation <= 7;
}
