import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { GraduationCap, Sparkles, ArrowLeft, Target, Loader2, CheckCircle2, Lightbulb, RefreshCw, Trash2, BookOpen } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTenant } from '@/contexts/TenantContext';
import { useLearningPath } from '@/hooks/useLearningPath';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const SAMPLE_GOALS = [
  'אני רוצה להפוך ליועץ AI עצמאי',
  'אני רוצה להקים סוכנות עצמאית',
  'אני רוצה למכור יותר ולהגדיל את המכירות שלי',
  'אני רוצה לבנות מוצר דיגיטלי וליצור הכנסה פסיבית',
];

export default function LearningPath() {
  const { language } = useLanguage();
  const { tenantSettings } = useTenant();
  const assistantName = tenantSettings?.ai_assistant_name?.trim() || (language === 'he' ? 'ג\u0027ייסון' : 'Jason');
  const { toast } = useToast();
  const { path, loading, generating, generate, reset } = useLearningPath();
  const [goal, setGoal] = useState('');

  const handleGenerate = async () => {
    if (!goal.trim()) {
      toast({
        title: language === 'he' ? 'נא להגדיר מטרה' : 'Please set a goal',
        variant: 'destructive',
      });
      return;
    }
    try {
      await generate(goal.trim());
      toast({
        title: language === 'he' ? 'המסלול שלך מוכן! 🎉' : 'Your path is ready! 🎉',
      });
    } catch (e) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: e instanceof Error ? e.message : 'Failed to generate',
        variant: 'destructive',
      });
    }
  };

  const handleReset = async () => {
    await reset();
    setGoal('');
  };

  const progress = path ? Math.round((path.current_step / path.steps.length) * 100) : 0;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Premium Header */}
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/15 via-card to-accent/10 p-5 sm:p-7">
        <div className="absolute -top-12 -end-12 w-56 h-56 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -start-12 w-56 h-56 bg-accent/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md shadow-primary/20">
              <GraduationCap className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {language === 'he' ? 'מסלול הלמידה שלי' : 'My Learning Path'}
            </h1>
          </div>
          <p className="text-muted-foreground">
            {language === 'he'
              ? `${assistantName} יבנה מסלול אישי על בסיס המטרה שלך`
              : `${assistantName} will build a personalized path based on your goal`}
          </p>
        </div>
      </div>

      {loading ? (
        <Card className="border-border/60">
          <CardContent className="py-16 flex flex-col items-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </CardContent>
        </Card>
      ) : path ? (
        // Existing learning path view
        <>
          <Card className="border-border/60 overflow-hidden relative">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary via-accent to-primary" />
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold text-primary uppercase tracking-wider">
                      {language === 'he' ? 'המטרה שלך' : 'Your goal'}
                    </span>
                  </div>
                  <CardTitle className="text-xl tracking-tight leading-snug">{path.goal}</CardTitle>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {language === 'he' ? 'לאפס את המסלול?' : 'Reset path?'}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {language === 'he'
                          ? 'אפשר יהיה לבנות מסלול חדש לאחר מכן'
                          : 'You can build a new path afterwards'}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-row-reverse gap-2">
                      <AlertDialogCancel>{language === 'he' ? 'ביטול' : 'Cancel'}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleReset}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {language === 'he' ? 'אפס' : 'Reset'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">
                    {language === 'he' ? 'התקדמות' : 'Progress'}
                  </span>
                  <span className="font-semibold text-primary">
                    {path.current_step} / {path.steps.length}
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            </CardContent>
          </Card>

          {/* Steps timeline */}
          <div className="space-y-3">
            {path.steps.map((step, index) => {
              const isCompleted = index < path.current_step;
              const isCurrent = index === path.current_step;
              const isFuture = index > path.current_step;

              return (
                <motion.div
                  key={step.course_id + index}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.08, ease: [0.33, 1, 0.68, 1] }}
                >
                  <Card
                    className={cn(
                      'border-border/60 overflow-hidden relative transition-all',
                      isCurrent && 'ring-2 ring-primary/40 shadow-md',
                      isFuture && 'opacity-60'
                    )}
                  >
                    <div className="flex items-start gap-4 p-5">
                      {/* Step indicator */}
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div
                          className={cn(
                            'w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm',
                            isCompleted && 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white',
                            isCurrent && 'bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-md shadow-primary/20',
                            isFuture && 'bg-muted text-muted-foreground'
                          )}
                        >
                          {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : index + 1}
                        </div>
                        {index < path.steps.length - 1 && (
                          <div
                            className={cn(
                              'w-0.5 h-full mt-2 min-h-[40px]',
                              isCompleted ? 'bg-emerald-500/40' : 'bg-border'
                            )}
                          />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 pb-2">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-semibold text-base tracking-tight mb-1">
                              {step.course_title}
                            </h3>
                            <p className="text-sm text-muted-foreground flex items-start gap-1.5">
                              <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
                              <span>{step.reason}</span>
                            </p>
                          </div>
                          {!isFuture && (
                            <Button
                              asChild
                              size="sm"
                              variant={isCurrent ? 'default' : 'outline'}
                              className={cn(
                                'flex-shrink-0',
                                isCurrent && 'shadow-md shadow-primary/20'
                              )}
                            >
                              <Link to={`/courses/${step.course_id}`}>
                                <BookOpen className="w-3.5 h-3.5 ml-1.5" />
                                {isCompleted
                                  ? language === 'he'
                                    ? 'חזור לקורס'
                                    : 'Revisit'
                                  : language === 'he'
                                  ? 'התחל'
                                  : 'Start'}
                                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                              </Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </>
      ) : (
        // No path yet — show goal input
        <Card className="border-border/60 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 tracking-tight">
              <Sparkles className="w-5 h-5 text-primary" />
              {language === 'he' ? 'מה המטרה שלך?' : "What's your goal?"}
            </CardTitle>
            <CardDescription>
              {language === 'he'
                ? `תיאור במשפט אחד של המטרה הרצויה, ו${assistantName} יבנה מסלול מותאם`
                : `Describe what you want to achieve in one sentence, and ${assistantName} will build a custom path`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={language === 'he' ? 'לדוגמה: אני רוצה ללמוד איך לבנות סוכנות AI...' : 'e.g., I want to learn how to build an AI agency...'}
              className="min-h-[100px] resize-none border-border/60 focus-visible:ring-primary/30 focus-visible:border-primary/50"
            />

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {language === 'he' ? 'דוגמאות' : 'Examples'}
              </p>
              <div className="flex flex-wrap gap-2">
                {SAMPLE_GOALS.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => setGoal(sample)}
                    className="text-xs px-3 py-1.5 rounded-full border border-border/60 bg-background hover:bg-primary/5 hover:border-primary/40 hover:text-primary transition-all"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={generating || !goal.trim()}
              className="w-full h-11 gap-2 bg-gradient-to-br from-primary to-accent shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {language === 'he' ? 'בונה את המסלול שלך...' : 'Building your path...'}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {language === 'he' ? 'בניית המסלול שלי' : 'Build my path'}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
