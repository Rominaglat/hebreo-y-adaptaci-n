import { useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { contactEmailKey, contactPhoneKey, entriesCovering, type ContactSuppression, type Person } from '@/lib/contactSuppression';
import type { NewSuppression } from '@/hooks/useContactSuppression';

interface ContactSuppressionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: ContactSuppression[];
  people: Array<Person & { full_name: string | null }>;
  onAdd: (entry: NewSuppression) => Promise<boolean>;
  onRemove: (ids: string[]) => Promise<boolean>;
}

/** Admin view of the do-not-contact list, including people who are not portal users. */
export function ContactSuppressionsDialog({ open, onOpenChange, entries, people, onAdd, onRemove }: ContactSuppressionsDialogProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [adding, setAdding] = useState(false);

  // Which portal user an entry reaches — by account, or by their phone / email.
  const whoFor = (e: ContactSuppression) => {
    const person = people.find((p) => entriesCovering([e], p).length > 0);
    return person ? person.full_name || person.email || '—' : '—';
  };

  const add = async () => {
    const phoneOk = !phone.trim() || contactPhoneKey(phone) !== null;
    if ((!phone.trim() && !email.trim()) || !phoneOk || (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
      toast({ title: t('contacts.list.needPhoneOrEmail'), variant: 'destructive' });
      return;
    }
    setAdding(true);
    // One entry per identifier, so a phone already listed doesn't block the email.
    const results = await Promise.all([
      ...(phone.trim() ? [onAdd({ phone, reason })] : []),
      ...(email.trim() ? [onAdd({ email: contactEmailKey(email) ?? email, reason })] : []),
    ]);
    setAdding(false);
    if (results.every(Boolean)) {
      toast({ title: t('contacts.list.added') });
      setPhone(''); setEmail(''); setReason('');
    } else {
      toast({ title: t('manageUsers.contact.error'), variant: 'destructive' });
    }
  };

  const remove = async (id: string) => {
    const ok = await onRemove([id]);
    toast(ok ? { title: t('contacts.list.removed') } : { title: t('manageUsers.contact.error'), variant: 'destructive' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('contacts.list.title')}</DialogTitle>
          <DialogDescription>{t('contacts.list.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-center">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('contacts.list.phone')} dir="ltr" inputMode="tel" aria-label={t('contacts.list.phone')} />
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('contacts.list.email')} dir="ltr" type="email" aria-label={t('contacts.list.email')} />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('contacts.list.reason')} aria-label={t('contacts.list.reason')} />
          <Button onClick={() => void add()} disabled={adding}>
            {adding ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Plus className="w-4 h-4 me-2" />}
            {t('contacts.list.add')}
          </Button>
        </div>

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t('contacts.list.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t('contacts.list.colWho')}</TableHead>
                  <TableHead className="text-start">{t('contacts.list.phone')}</TableHead>
                  <TableHead className="text-start">{t('contacts.list.email')}</TableHead>
                  <TableHead className="text-start">{t('contacts.list.colSource')}</TableHead>
                  <TableHead className="text-start">{t('contacts.list.reason')}</TableHead>
                  <TableHead className="text-start">{t('contacts.list.colDate')}</TableHead>
                  <TableHead className="w-10"><span className="sr-only">{t('contacts.list.remove')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{whoFor(e)}</TableCell>
                    <TableCell dir="ltr" className="text-start tabular-nums">{e.phone ?? '—'}</TableCell>
                    <TableCell dir="ltr" className="text-start">{e.email ?? '—'}</TableCell>
                    <TableCell>{t(`contacts.source.${e.source}`)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{e.reason ?? ''}</TableCell>
                    <TableCell className="tabular-nums text-sm">{format(new Date(e.created_at), 'd.M.yyyy')}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => void remove(e.id)} aria-label={t('contacts.list.remove')} title={t('contacts.list.remove')}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
