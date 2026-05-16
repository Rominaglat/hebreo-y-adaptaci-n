import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import type {
  Answer,
  DiscColor,
  ForcedChoiceQuestion,
  LikertQuestion,
  Question,
} from '@/lib/personality/types';
import { cn } from '@/lib/utils';

interface QuestionCardProps {
  question: Question;
  answer: Answer | undefined;
  onAnswer: (answer: Answer) => void;
}

const LIKERT_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'כלל לא',
  2: 'מעט',
  3: 'בינוני',
  4: 'נכון',
  5: 'נכון מאוד',
};

const LIKERT_DESC: Record<1 | 5, string> = {
  1: 'בכלל לא נכון אצלי',
  5: 'נכון מאוד אצלי',
};

export function QuestionCard({ question, answer, onAnswer }: QuestionCardProps) {
  if (question.type === 'likert') {
    return <LikertCard question={question} answer={answer} onAnswer={onAnswer} />;
  }
  return <ForcedChoiceCard question={question} answer={answer} onAnswer={onAnswer} />;
}

function LikertCard({
  question,
  answer,
  onAnswer,
}: {
  question: LikertQuestion;
  answer: Answer | undefined;
  onAnswer: (answer: Answer) => void;
}) {
  const current = answer?.type === 'likert' ? answer.value : null;

  return (
    <motion.div
      key={question.qid}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="space-y-7"
    >
      <p className="text-2xl sm:text-[28px] font-bold leading-snug tracking-tight text-foreground">
        {question.text}
      </p>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>{LIKERT_DESC[1]}</span>
          <span>{LIKERT_DESC[5]}</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {([1, 2, 3, 4, 5] as const).map((v) => {
            const selected = current === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() =>
                  onAnswer({
                    qid: question.qid,
                    type: 'likert',
                    axis: question.axis,
                    value: v,
                  })
                }
                className={cn(
                  'group relative flex flex-col items-center gap-2 p-3 sm:p-4 rounded-xl border-2 transition-all duration-200',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/25 scale-[1.03]'
                    : 'border-border bg-card hover:border-primary/40 hover:bg-accent/30',
                )}
              >
                <div
                  className={cn(
                    'w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-sm sm:text-base font-bold tabular-nums transition',
                    selected
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-muted text-muted-foreground group-hover:bg-primary/15 group-hover:text-primary',
                  )}
                >
                  {selected ? <Check className="w-4 h-4 sm:w-5 sm:h-5" /> : v}
                </div>
                <span
                  className={cn(
                    'text-[11px] sm:text-xs font-medium leading-tight text-center',
                    selected ? 'text-primary-foreground' : 'text-foreground/70',
                  )}
                >
                  {LIKERT_LABELS[v]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function ForcedChoiceCard({
  question,
  answer,
  onAnswer,
}: {
  question: ForcedChoiceQuestion;
  answer: Answer | undefined;
  onAnswer: (answer: Answer) => void;
}) {
  const fc = answer?.type === 'forced_choice' ? answer : null;
  const picked = fc?.most ?? null;

  const handlePick = (color: DiscColor) => {
    onAnswer({
      qid: question.qid,
      type: 'forced_choice',
      most: color,
    });
  };

  return (
    <motion.div
      key={question.qid}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="space-y-6"
    >
      <p className="text-2xl sm:text-[28px] font-bold leading-snug tracking-tight text-foreground">
        מה הכי מתאר אותך?
      </p>

      <div className="grid grid-cols-1 gap-3">
        {question.options.map((opt) => {
          const isSelected = picked === opt.color;
          return (
            <button
              key={opt.color}
              type="button"
              onClick={() => handlePick(opt.color)}
              className={cn(
                'group relative flex items-start gap-3 p-4 rounded-2xl border-2 text-start transition-all duration-200',
                isSelected
                  ? 'border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                  : 'border-border bg-card hover:border-primary/40 hover:bg-accent/30',
              )}
            >
              <div
                className={cn(
                  'mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition border-2',
                  isSelected
                    ? 'bg-primary-foreground/20 border-primary-foreground/40 text-primary-foreground'
                    : 'border-border bg-card',
                )}
              >
                {isSelected && <Check className="w-3.5 h-3.5" />}
              </div>
              <div
                className={cn(
                  'font-semibold leading-snug text-[15px] sm:text-base',
                  isSelected ? 'text-primary-foreground' : 'text-foreground',
                )}
              >
                {opt.text}
              </div>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
