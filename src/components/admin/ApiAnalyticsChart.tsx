import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Activity, TrendingUp, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

interface ApiStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  requestsByAction: { action: string; count: number }[];
  requestsByDay: { date: string; total: number; success: number; failed: number }[];
}

export function ApiAnalyticsChart() {
  const { language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ApiStats | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: logs, error } = await (supabase
        .from('api_request_logs' as any) as any)
        .select('*')
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (logs && logs.length > 0) {
        // Calculate stats
        const totalRequests = logs.length;
        const successfulRequests = logs.filter((l: any) => l.status_code >= 200 && l.status_code < 300).length;
        const failedRequests = logs.filter((l: any) => l.status_code >= 400).length;
        const avgResponseTime = Math.round(
          logs.reduce((sum: number, l: any) => sum + (l.response_time_ms || 0), 0) / totalRequests
        );

        // Group by action
        const actionCounts: Record<string, number> = {};
        logs.forEach((l: any) => {
          actionCounts[l.action] = (actionCounts[l.action] || 0) + 1;
        });
        const requestsByAction = Object.entries(actionCounts)
          .map(([action, count]) => ({ action, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        // Group by day
        const dayCounts: Record<string, { total: number; success: number; failed: number }> = {};
        logs.forEach((l: any) => {
          const date = new Date(l.created_at).toLocaleDateString(language === 'he' ? 'he-IL' : 'en-US', { 
            month: 'short', 
            day: 'numeric' 
          });
          if (!dayCounts[date]) {
            dayCounts[date] = { total: 0, success: 0, failed: 0 };
          }
          dayCounts[date].total++;
          if (l.status_code >= 200 && l.status_code < 300) {
            dayCounts[date].success++;
          } else if (l.status_code >= 400) {
            dayCounts[date].failed++;
          }
        });
        const requestsByDay = Object.entries(dayCounts).map(([date, counts]) => ({
          date,
          ...counts
        }));

        setStats({
          totalRequests,
          successfulRequests,
          failedRequests,
          avgResponseTime,
          requestsByAction,
          requestsByDay
        });
      } else {
        setStats({
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          avgResponseTime: 0,
          requestsByAction: [],
          requestsByDay: []
        });
      }
    } catch (error) {
      console.error('Error fetching API analytics:', error);
      setStats({
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        avgResponseTime: 0,
        requestsByAction: [],
        requestsByDay: []
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="mb-6">
        <CardContent className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;

  const successRate = stats.totalRequests > 0 
    ? Math.round((stats.successfulRequests / stats.totalRequests) * 100) 
    : 0;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          {language === 'he' ? 'אנליטיקס API' : 'API Analytics'}
        </CardTitle>
        <CardDescription>
          {language === 'he' ? 'סטטיסטיקות שימוש ב-API ב-30 הימים האחרונים' : 'API usage statistics for the last 30 days'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted/50 rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">
                {language === 'he' ? 'סה"כ בקשות' : 'Total Requests'}
              </span>
            </div>
            <p className="text-2xl font-bold">{stats.totalRequests.toLocaleString()}</p>
          </div>
          
          <div className="bg-muted/50 rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span className="text-sm text-muted-foreground">
                {language === 'he' ? 'אחוז הצלחה' : 'Success Rate'}
              </span>
            </div>
            <p className="text-2xl font-bold text-success">{successRate}%</p>
          </div>
          
          <div className="bg-muted/50 rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <span className="text-sm text-muted-foreground">
                {language === 'he' ? 'שגיאות' : 'Failed'}
              </span>
            </div>
            <p className="text-2xl font-bold text-destructive">{stats.failedRequests.toLocaleString()}</p>
          </div>
          
          <div className="bg-muted/50 rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">
                {language === 'he' ? 'זמן תגובה ממוצע' : 'Avg Response'}
              </span>
            </div>
            <p className="text-2xl font-bold text-primary">{stats.avgResponseTime}ms</p>
          </div>
        </div>

        {/* Charts */}
        {stats.totalRequests > 0 && (
          <Tabs defaultValue="timeline" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="timeline">
                {language === 'he' ? 'ציר זמן' : 'Timeline'}
              </TabsTrigger>
              <TabsTrigger value="actions">
                {language === 'he' ? 'לפי פעולה' : 'By Action'}
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="timeline" className="h-64 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.requestsByDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.7)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={{ stroke: 'hsl(var(--border) / 0.7)' }}
                    tickLine={{ stroke: 'hsl(var(--border) / 0.7)' }}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={{ stroke: 'hsl(var(--border) / 0.7)' }}
                    tickLine={{ stroke: 'hsl(var(--border) / 0.7)' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      color: 'hsl(var(--foreground))',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="success" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    name={language === 'he' ? 'הצלחה' : 'Success'}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="failed" 
                    stroke="hsl(var(--destructive))" 
                    strokeWidth={2}
                    name={language === 'he' ? 'שגיאה' : 'Failed'}
                  />
                </LineChart>
              </ResponsiveContainer>
            </TabsContent>
            
            <TabsContent value="actions" className="h-64 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.requestsByAction} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.7)" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={{ stroke: 'hsl(var(--border) / 0.7)' }}
                    tickLine={{ stroke: 'hsl(var(--border) / 0.7)' }}
                  />
                  <YAxis
                    dataKey="action"
                    type="category"
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    width={120}
                    axisLine={{ stroke: 'hsl(var(--border) / 0.7)' }}
                    tickLine={{ stroke: 'hsl(var(--border) / 0.7)' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      color: 'hsl(var(--foreground))',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Bar 
                    dataKey="count" 
                    fill="hsl(var(--primary))" 
                    radius={[0, 4, 4, 0]}
                    name={language === 'he' ? 'בקשות' : 'Requests'}
                  />
                </BarChart>
              </ResponsiveContainer>
            </TabsContent>
          </Tabs>
        )}

        {stats.totalRequests === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            {language === 'he' ? 'אין נתונים להצגה עדיין' : 'No data to display yet'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
