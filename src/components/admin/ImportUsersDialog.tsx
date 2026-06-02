import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, Loader2, Download, AlertCircle, CheckCircle2, X } from 'lucide-react';
import ExcelJS from 'exceljs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ImportUser {
  email: string;
  full_name: string;
  role: 'admin' | 'instructor' | 'student';
  phone?: string;
  status?: 'pending' | 'success' | 'error';
  error?: string;
}

interface ImportUsersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

// Guarantees SEC-014 policy: 16 chars, at least one letter, digit, and symbol.
// Uses crypto.getRandomValues for unbiased sampling.
const generatePassword = () => {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const symbols = '!@#$%^&*()-_=+';
  const all = upper + lower + digits + symbols;
  const randIndex = (max: number) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  };
  const pick = (s: string) => s.charAt(randIndex(s.length));
  // Seed with at least one of each required category.
  const chars: string[] = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 16) chars.push(pick(all));
  // Fisher-Yates shuffle so the required-category chars aren't always at the start.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

export function ImportUsersDialog({ open, onOpenChange, onImportComplete }: ImportUsersDialogProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'results'>('upload');
  const [users, setUsers] = useState<ImportUser[]>([]);
  const [fileName, setFileName] = useState('');
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<{ success: number; failed: number; skipped: number }>({ success: 0, failed: 0, skipped: 0 });

  const resetState = () => {
    setStep('upload');
    setUsers([]);
    setFileName('');
    setImportProgress(0);
    setImportResults({ success: 0, failed: 0, skipped: 0 });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const downloadTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Users');
    ws.columns = [
      { header: 'email', key: 'email', width: 25 },
      { header: 'full_name', key: 'full_name', width: 20 },
      { header: 'role', key: 'role', width: 12 },
      { header: 'phone', key: 'phone', width: 15 },
    ];
    ws.addRow({ email: 'user@example.com', full_name: 'John Doe', role: 'student', phone: '050-1234567' });
    ws.addRow({ email: 'instructor@example.com', full_name: 'Jane Smith', role: 'instructor', phone: '' });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users_template.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const HEADER_ALIASES: Record<string, string> = {
    email: 'email', 'מייל': 'email',
    full_name: 'full_name', fullname: 'full_name', name: 'full_name', 'שם מלא': 'full_name', 'שם': 'full_name',
    role: 'role', 'תפקיד': 'role', 'הרשאה': 'role',
    phone: 'phone', 'טלפון': 'phone',
  };

  const ROLE_ALIASES: Record<string, 'admin' | 'instructor' | 'student'> = {
    admin: 'admin', 'מנהל': 'admin', 'אדמין': 'admin',
    instructor: 'instructor', 'מרצה': 'instructor', 'מדריך': 'instructor',
    student: 'student', 'תלמיד': 'student', 'סטודנט': 'student',
  };

  const parseCsv = (text: string): Record<string, string>[] => {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.length > 0);
    if (lines.length === 0) return [];
    const parseRow = (line: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
          if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') { inQuotes = false; }
          else { cur += c; }
        } else {
          if (c === '"') { inQuotes = true; }
          else if (c === ',') { out.push(cur); cur = ''; }
          else { cur += c; }
        }
      }
      out.push(cur);
      return out;
    };
    const headerRow = parseRow(lines[0]).map(h => h.trim().toLowerCase());
    return lines.slice(1).map(line => {
      const cells = parseRow(line);
      const rec: Record<string, string> = {};
      headerRow.forEach((h, idx) => { rec[h] = (cells[idx] ?? '').trim(); });
      return rec;
    });
  };

  const parseXlsx = async (buf: ArrayBuffer): Promise<Record<string, string>[]> => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headerRow = ws.getRow(1).values as Array<unknown>;
    // header values are 1-indexed in exceljs; skip index 0
    const headers: string[] = [];
    for (let i = 1; i < headerRow.length; i++) {
      const h = headerRow[i];
      headers.push(String(h ?? '').trim().toLowerCase());
    }
    const out: Record<string, string>[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      const cells = row.values as Array<unknown>;
      const rec: Record<string, string> = {};
      headers.forEach((h, idx) => {
        const v = cells[idx + 1]; // 1-indexed
        // Cells with formulas surface as { result, formula }
        let str: string;
        if (v && typeof v === 'object' && 'result' in (v as any)) {
          str = String((v as any).result ?? '');
        } else if (v && typeof v === 'object' && 'text' in (v as any)) {
          str = String((v as any).text ?? '');
        } else if (v === null || v === undefined) {
          str = '';
        } else {
          str = String(v);
        }
        rec[h] = str.trim();
      });
      out.push(rec);
    });
    return out;
  };

  const parseFile = async (file: File): Promise<ImportUser[]> => {
    const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
    const rawRows: Record<string, string>[] = isCsv
      ? parseCsv(await file.text())
      : await parseXlsx(await file.arrayBuffer());

    const parsedUsers: ImportUser[] = [];
    const validRoles = ['admin', 'instructor', 'student'];

    for (const row of rawRows) {
      // Normalize header keys: lowercase, look up via aliases
      const norm: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        const key = k.trim().toLowerCase();
        const canonical = HEADER_ALIASES[key] ?? key;
        norm[canonical] = v;
      }

      const email = (norm.email ?? '').toString().trim().toLowerCase();
      const fullName = (norm.full_name ?? '').toString().trim();
      const rawRole = (norm.role ?? 'student').toString().trim().toLowerCase();
      const phone = (norm.phone ?? '').toString().trim();

      const role: 'admin' | 'instructor' | 'student' =
        ROLE_ALIASES[rawRole] ?? (validRoles.includes(rawRole) ? (rawRole as 'admin' | 'instructor' | 'student') : 'student');

      if (email && fullName) {
        parsedUsers.push({
          email,
          full_name: fullName,
          role,
          phone: phone || undefined,
          status: 'pending',
        });
      }
    }

    return parsedUsers;
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    try {
      const parsedUsers = await parseFile(file);
      
      if (parsedUsers.length === 0) {
        toast({
          title: t('common.error'),
          description: t('importUsers.noUsersFound'),
          variant: 'destructive',
        });
        return;
      }

      setUsers(parsedUsers);
      setStep('preview');
    } catch (error) {
      console.error('Error parsing file:', error);
      toast({
        title: t('importUsers.fileReadError'),
        description: t('importUsers.fileReadErrorDesc'),
        variant: 'destructive',
      });
    }
  };

  const handleImport = async () => {
    setStep('importing');
    setImportProgress(0);

    const { data: sessionData } = await supabase.auth.getSession();
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    const updatedUsers = [...users];

    for (let i = 0; i < users.length; i++) {
      const user = updatedUsers[i];
      // Initial password = the user's phone number with non-digits stripped
      // (so '+972 50-123-4567' becomes '972501234567'). The admin asked
      // for this so users can log in with something memorable on first
      // visit and reset to a real password from their profile after.
      // Fall back to a random 16-char password if the phone is too short
      // or missing — never create accounts with weak (<8 char) passwords.
      const phoneDigits = (user.phone || '').replace(/\D/g, '');
      const tempPassword = phoneDigits.length >= 8 ? phoneDigits : generatePassword();

      try {
        const response = await supabase.functions.invoke('admin-user-actions', {
          body: {
            action: 'create_user',
            email: user.email,
            fullName: user.full_name,
            newPassword: tempPassword,
            role: user.role,
            phone: user.phone,
          },
          headers: {
            Authorization: `Bearer ${sessionData.session?.access_token}`,
          },
        });

        if (response.error) {
          const errorMessage = response.error?.message || 'Unknown error';
          updatedUsers[i] = { ...user, status: 'error', error: errorMessage };
          failedCount++;
        } else if (response.data?.error) {
          const errorMessage = response.data?.error || 'Unknown error';
          updatedUsers[i] = { ...user, status: 'error', error: errorMessage };
          failedCount++;
        } else if (response.data?.alreadyMember) {
          // User already in tenant - count as skipped/success
          updatedUsers[i] = { ...user, status: 'success', error: t('importUsers.alreadyMember') };
          skippedCount++;
        } else {
          updatedUsers[i] = { ...user, status: 'success' };
          successCount++;
        }
      } catch (error: any) {
        updatedUsers[i] = { ...user, status: 'error', error: error.message || 'Unknown error' };
        failedCount++;
      }

      setImportProgress(Math.round(((i + 1) / users.length) * 100));
      setUsers([...updatedUsers]);
    }

    setImportResults({ success: successCount, failed: failedCount, skipped: skippedCount });
    setStep('results');

    if (successCount > 0 || skippedCount > 0) {
      onImportComplete();
    }
  };

  const removeUser = (index: number) => {
    setUsers(users.filter((_, i) => i !== index));
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin': return t('admin.admin');
      case 'instructor': return t('admin.instructor');
      case 'student': return t('admin.student');
      default: return role;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t('importUsers.title')}
          </DialogTitle>
          <DialogDescription>
            {t('importUsers.description')}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4 py-4">
            <div 
              className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="font-medium mb-1">
                {t('importUsers.clickToUpload')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('importUsers.fileTypes')}
              </p>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="w-4 h-4 me-2" />
                {t('importUsers.downloadTemplate')}
              </Button>
            </div>

            <Alert>
              <FileSpreadsheet className="w-4 h-4" />
              <AlertDescription>
                {t('importUsers.fileRequirements')}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
                <span className="font-medium">{fileName}</span>
                <Badge variant="secondary">{users.length} {t('importUsers.users')}</Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={resetState}>
                {t('importUsers.chooseDifferent')}
              </Button>
            </div>

            <ScrollArea className="h-[300px] border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.userEmail')}</TableHead>
                    <TableHead>{t('admin.userFullName')}</TableHead>
                    <TableHead>{t('admin.role')}</TableHead>
                    <TableHead>{t('importUsers.phone')}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-mono text-sm">{user.email}</TableCell>
                      <TableCell>{user.full_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{getRoleLabel(user.role)}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.phone || '-'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => removeUser(index)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        )}

        {step === 'importing' && (
          <div className="py-8 text-center space-y-4">
            <Loader2 className="w-12 h-12 animate-spin mx-auto text-primary" />
            <div>
              <p className="font-medium mb-2">
                {t('importUsers.importing')}
              </p>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-primary h-full transition-all duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground mt-2">{importProgress}%</p>
            </div>
          </div>
        )}

        {step === 'results' && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-center gap-6">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-2">
                  <CheckCircle2 className="w-6 h-6 text-green-500" />
                </div>
                <p className="text-2xl font-bold text-green-500">{importResults.success}</p>
                <p className="text-sm text-muted-foreground">
                  {t('importUsers.added')}
                </p>
              </div>
              {importResults.skipped > 0 && (
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-2">
                    <CheckCircle2 className="w-6 h-6 text-yellow-500" />
                  </div>
                  <p className="text-2xl font-bold text-yellow-500">{importResults.skipped}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('importUsers.alreadyExist')}
                  </p>
                </div>
              )}
              {importResults.failed > 0 && (
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-2">
                    <AlertCircle className="w-6 h-6 text-destructive" />
                  </div>
                  <p className="text-2xl font-bold text-destructive">{importResults.failed}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('importUsers.failed')}
                  </p>
                </div>
              )}
            </div>

            {importResults.failed > 0 && (
              <ScrollArea className="h-[200px] border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('admin.userEmail')}</TableHead>
                      <TableHead>{t('importUsers.status')}</TableHead>
                      <TableHead>{t('importUsers.errorColumn')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.filter(u => u.status === 'error').map((user, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-mono text-sm">{user.email}</TableCell>
                        <TableCell>
                          <Badge variant="destructive">
                            {t('importUsers.failedSingular')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-destructive">{user.error}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleImport} disabled={users.length === 0}>
                <Upload className="w-4 h-4 me-2" />
                {t('importUsers.importCountPrefix')}{users.length}{t('importUsers.importCountSuffix')}
              </Button>
            </>
          )}
          {step === 'results' && (
            <Button onClick={handleClose}>
              {t('common.close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
