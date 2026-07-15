import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Megaphone, Loader2, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/components/ui/use-toast';

interface AnnounceContentButtonProps {
  courseId: string;
  courseName?: string;
}

export default function AnnounceContentButton({ courseId, courseName }: AnnounceContentButtonProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const openDialog = () => {
    setTitle(courseName ? `${t('announce.defaultTitlePrefix')} ${courseName}` : t('announce.defaultTitlePrefix'));
    setMessage('');
    setOpen(true);
  };

  const send = async () => {
    if (!title.trim() || !message.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('announce-course-content', {
        body: { courseId, title: title.trim(), message: message.trim() },
      });
      if (error) throw error;
      const emailed = (data as { emailed?: number } | null)?.emailed ?? 0;
      toast({ title: t('announce.sent'), description: t('announce.sentDesc').replace('{n}', String(emailed)) });
      setOpen(false);
    } catch (e) {
      toast({ title: t('announce.error'), description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" onClick={openDialog}>
        <Megaphone className="w-4 h-4 ml-2" />
        {t('announce.button')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('announce.dialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>{t('announce.titleLabel')}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('announce.messageLabel')}</Label>
              <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder={t('announce.messagePlaceholder')} />
            </div>
            <p className="text-xs text-muted-foreground">{t('announce.audienceHint')}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={sending}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={() => void send()} disabled={sending || !title.trim() || !message.trim()}>
              {sending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Send className="w-4 h-4 ml-2" />}
              {t('announce.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
