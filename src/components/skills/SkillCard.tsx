import { Link } from 'react-router-dom';
import { Star, Download, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Skill } from '@/hooks/useSkills';
import { SkillIcon } from './SkillIcon';

interface SkillCardProps {
  skill: Skill;
  showStatus?: boolean;
  onAdminDelete?: (skillId: string) => void;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  submitted: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  scanning: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

export function SkillCard({ skill, showStatus = false, onAdminDelete }: SkillCardProps) {
  const { t, language } = useLanguage();

  return (
    <div className="relative h-full group/admin">
      {onAdminDelete && (
        <Button
          variant="outline"
          size="icon"
          className="absolute top-2 end-2 z-10 w-8 h-8 bg-background/90 backdrop-blur text-red-600 border-red-200 hover:bg-red-50 hover:border-red-400 dark:border-red-800 dark:hover:bg-red-950 shadow-sm opacity-0 group-hover/admin:opacity-100 transition-opacity"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAdminDelete(skill.id); }}
          title={language === 'he' ? 'הסרת סקיל' : 'Remove skill'}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )}
    <Link to={`/skills/${skill.id}`}>
      <Card className="h-full hover:shadow-lg hover:-translate-y-1 transition-all duration-300 ease-out-cubic cursor-pointer group border-border/60 overflow-hidden relative">
        {/* Featured glow */}
        {skill.is_featured && (
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400" />
        )}
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br from-primary/15 to-accent/10 flex items-center justify-center group-hover:scale-105 group-hover:rotate-3 transition-transform duration-300">
                <SkillIcon iconName={skill.icon_name} category={skill.category} className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                  {skill.name}
                </h3>
                <Badge variant="outline" className="text-xs mt-0.5">
                  {t(`skills.categories.${skill.category}`) || skill.category}
                </Badge>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              {skill.is_featured && (
                <Badge className="bg-amber-500 text-white text-xs">{t('skills.featured')}</Badge>
              )}
              {showStatus && (
                <Badge className={`text-xs ${statusColors[skill.status] || ''}`}>
                  {t(`skills.status.${skill.status}`)}
                </Badge>
              )}
            </div>
          </div>

          <p className="text-sm text-muted-foreground line-clamp-2 mb-3 min-h-[2.5rem]">
            {skill.description || ''}
          </p>

          {skill.tags && skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {skill.tags.slice(0, 3).map(tag => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {skill.tags.length > 3 && (
                <Badge variant="secondary" className="text-xs">
                  +{skill.tags.length - 3}
                </Badge>
              )}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                {Number(skill.avg_rating).toFixed(1)}
                <span className="text-muted-foreground/60">({skill.rating_count})</span>
              </span>
              <span className="flex items-center gap-1">
                <Download className="w-3.5 h-3.5" />
                {skill.download_count}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
    </div>
  );
}
