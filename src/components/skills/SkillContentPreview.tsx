import { ScrollArea } from '@/components/ui/scroll-area';

interface SkillContentPreviewProps {
  content: string;
  maxHeight?: string;
}

export function SkillContentPreview({ content, maxHeight = '400px' }: SkillContentPreviewProps) {
  return (
    <ScrollArea style={{ maxHeight }} className="w-full">
      <pre className="text-sm font-mono whitespace-pre-wrap break-words p-4 bg-muted rounded-lg">
        {content}
      </pre>
    </ScrollArea>
  );
}
