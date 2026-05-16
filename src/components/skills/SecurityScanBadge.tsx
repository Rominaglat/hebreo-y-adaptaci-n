import { ShieldCheck, ShieldAlert, ShieldX, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLanguage } from '@/contexts/LanguageContext';

interface SecurityScanBadgeProps {
  status: string;
  scanResult?: any;
}

export function SecurityScanBadge({ status, scanResult }: SecurityScanBadgeProps) {
  const { t } = useLanguage();

  if (status === 'scanning') {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t('skills.status.scanning')}
      </Badge>
    );
  }

  if (status === 'approved') {
    return (
      <Popover>
        <PopoverTrigger>
          <Badge className="gap-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 cursor-pointer">
            <ShieldCheck className="w-3 h-3" />
            {t('skills.scanPassed')}
          </Badge>
        </PopoverTrigger>
        {scanResult && (
          <PopoverContent className="w-80 text-sm" align="start">
            <h4 className="font-semibold mb-2">{t('skills.scanResults')}</h4>
            <div className="space-y-1 text-xs">
              <p>Layer 1: {scanResult.layer1?.critical_count || 0} critical, {scanResult.layer1?.warning_count || 0} warnings</p>
              {scanResult.layer2?.ran && (
                <p>Layer 2 (AI): {scanResult.layer2.risk_level} risk</p>
              )}
              {scanResult.layer2?.summary && (
                <p className="text-muted-foreground mt-1">{scanResult.layer2.summary}</p>
              )}
            </div>
          </PopoverContent>
        )}
      </Popover>
    );
  }

  if (status === 'rejected') {
    return (
      <Popover>
        <PopoverTrigger>
          <Badge className="gap-1 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 cursor-pointer">
            <ShieldX className="w-3 h-3" />
            {t('skills.scanFailed')}
          </Badge>
        </PopoverTrigger>
        {scanResult && (
          <PopoverContent className="w-80 text-sm" align="start">
            <h4 className="font-semibold mb-2">{t('skills.scanResults')}</h4>
            <div className="space-y-1 text-xs">
              {scanResult.layer1?.findings?.map((f: any, i: number) => (
                <p key={i} className="text-red-600 dark:text-red-400">
                  Line {f.line}: [{f.severity}] {f.type} — {f.match}
                </p>
              ))}
              {scanResult.layer2?.findings?.map((f: any, i: number) => (
                <p key={`l2-${i}`} className="text-orange-600 dark:text-orange-400">
                  Line {f.line}: {f.type} — {f.description}
                </p>
              ))}
            </div>
          </PopoverContent>
        )}
      </Popover>
    );
  }

  // submitted / pending review
  return (
    <Badge variant="outline" className="gap-1">
      <ShieldAlert className="w-3 h-3" />
      {t('skills.scanPending')}
    </Badge>
  );
}
