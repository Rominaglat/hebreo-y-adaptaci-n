import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import {
  ExternalLink,
  Filter,
  ScanSearch,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  DISC_COLOR_LABELS_HE,
  DISC_COLOR_NAMES_HE,
  EMYTH_AXIS_NAMES_HE,
} from '@/lib/personality/types';
import type {
  DiscColor,
  EmythAxis,
  PersonalityAssessment,
} from '@/lib/personality/types';

type Row = PersonalityAssessment & {
  member_name: string | null;
  member_avatar: string | null;
};

const EMYTH_COLOR: Record<EmythAxis, string> = {
  EM: '#CE1EE8',
  MN: '#1EE8DB',
  AR: '#E88A1E',
};

const DISC_COLOR_HEX: Record<DiscColor, string> = {
  R: '#E5484D',
  Y: '#F5A524',
  G: '#2BB673',
  B: '#3B82F6',
};

function rankedEmyth(row: PersonalityAssessment) {
  const arr: { key: EmythAxis; value: number }[] = [
    { key: 'EM', value: row.emyth_scores.entrepreneur },
    { key: 'MN', value: row.emyth_scores.manager },
    { key: 'AR', value: row.emyth_scores.artisan },
  ];
  return arr.sort((a, b) => b.value - a.value);
}

export default function PersonalityResultsAdmin() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterColor, setFilterColor] = useState<DiscColor | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) return;
      setLoading(true);
      try {
        const { data: assessments, error } = await supabase
          .from('personality_assessments')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;

        const rowsData = (assessments ?? []) as unknown as PersonalityAssessment[];
        const userIds = Array.from(new Set(rowsData.map((r) => r.user_id)));
        const memberMap = new Map<string, { full_name: string | null; avatar_url: string | null }>();
        if (userIds.length > 0) {
          // Profiles are the single source of truth post tenant_memberships drop.
          const { data: members } = await supabase
            .from('profiles')
            .select('id, full_name, avatar_url')
            .in('id', userIds);
          for (const m of members ?? []) {
            memberMap.set(m.id, {
              full_name: m.full_name ?? null,
              avatar_url: m.avatar_url ?? null,
            });
          }
        }
        const enriched: Row[] = rowsData.map((r) => ({
          ...r,
          member_name: memberMap.get(r.user_id)?.full_name ?? null,
          member_avatar: memberMap.get(r.user_id)?.avatar_url ?? null,
        }));
        if (!cancelled) setRows(enriched);
      } catch (e) {
        console.error('Failed to load personality assessments admin', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [user]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterColor !== 'all' && r.disc_primary !== filterColor) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const name = (r.member_name ?? '').toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filterColor, search]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanSearch className="w-5 h-5" />
            תוצאות שאלוני אישיות
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4">
            <Input
              placeholder="חיפוש לפי שם משתמש"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={filterColor} onValueChange={(v) => setFilterColor(v as DiscColor | 'all')}>
              <SelectTrigger className="max-w-[180px]">
                <Filter className="w-4 h-4 me-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הסגנונות</SelectItem>
                <SelectItem value="R">{DISC_COLOR_NAMES_HE.R}</SelectItem>
                <SelectItem value="Y">{DISC_COLOR_NAMES_HE.Y}</SelectItem>
                <SelectItem value="G">{DISC_COLOR_NAMES_HE.G}</SelectItem>
                <SelectItem value="B">{DISC_COLOR_NAMES_HE.B}</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-sm text-muted-foreground self-center">
              {loading ? 'טוען...' : `${filtered.length} מתוך ${rows.length}`}
            </div>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {rows.length === 0 ? 'אין תוצאות שמורות עדיין' : 'אין התאמות לסינון הנוכחי'}
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((r) => {
                const top = rankedEmyth(r)[0];
                return (
                  <div
                    key={r.id}
                    className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-4 px-4 py-3 border-b border-border/40 hover:bg-accent/30 transition rounded-lg"
                  >
                    <Avatar className="w-9 h-9">
                      {r.member_avatar && <AvatarImage src={r.member_avatar} />}
                      <AvatarFallback>{(r.member_name ?? 'U').slice(0, 1)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{r.member_name ?? 'ללא שם'}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {format(new Date(r.created_at), 'd בMMM yyyy', { locale: he })}
                      </div>
                    </div>
                    <span
                      className="text-sm font-bold tabular-nums hidden sm:inline"
                      style={{ color: EMYTH_COLOR[top.key] }}
                    >
                      {EMYTH_AXIS_NAMES_HE[top.key]} {top.value}%
                    </span>
                    <span
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ color: DISC_COLOR_HEX[r.disc_primary] }}
                    >
                      {DISC_COLOR_NAMES_HE[r.disc_primary]}
                    </span>
                    {r.disc_secondary ? (
                      <span
                        className="text-xs font-medium hidden sm:inline opacity-70"
                        style={{ color: DISC_COLOR_HEX[r.disc_secondary] }}
                      >
                        + {DISC_COLOR_NAMES_HE[r.disc_secondary]}
                      </span>
                    ) : <span />}
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/personality/${r.id}`}>
                        <ExternalLink className="w-4 h-4 me-1" />
                        פתח דשבורד
                      </Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// suppress unused import warnings
void DISC_COLOR_LABELS_HE;
