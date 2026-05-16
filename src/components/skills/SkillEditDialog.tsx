import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUpdateSkillMetadata, SKILL_CATEGORIES, type Skill } from '@/hooks/useSkills';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { SKILL_ICON_OPTIONS, SkillIcon } from './SkillIcon';

interface SkillEditDialogProps {
  skill: Skill;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SkillEditDialog({ skill, open, onOpenChange }: SkillEditDialogProps) {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const updateMutation = useUpdateSkillMetadata();

  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description || '');
  const [longDescription, setLongDescription] = useState(skill.long_description || '');
  const [category, setCategory] = useState(skill.category);
  const [tagsInput, setTagsInput] = useState((skill.tags || []).join(', '));
  const [triggerPattern, setTriggerPattern] = useState(skill.trigger_pattern || '');
  const [iconName, setIconName] = useState(skill.icon_name || '');

  useEffect(() => {
    if (open) {
      setName(skill.name);
      setDescription(skill.description || '');
      setLongDescription(skill.long_description || '');
      setCategory(skill.category);
      setTagsInput((skill.tags || []).join(', '));
      setTriggerPattern(skill.trigger_pattern || '');
      setIconName(skill.icon_name || '');
    }
  }, [open, skill]);

  const handleSave = () => {
    const tags = tagsInput.split(',').map(tag => tag.trim()).filter(Boolean);
    updateMutation.mutate(
      {
        skill_id: skill.id,
        name: name.trim(),
        description: description.trim() || undefined,
        long_description: longDescription.trim() || undefined,
        category,
        tags,
        trigger_pattern: triggerPattern.trim() || undefined,
        icon_name: iconName || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: language === 'he' ? 'עודכן בהצלחה' : 'Updated successfully' });
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('skills.editSkill')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>{t('skills.name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label>{t('skills.description')}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label>{t('skills.longDescription')}</Label>
            <Textarea
              value={longDescription}
              onChange={(e) => setLongDescription(e.target.value)}
              rows={3}
              className="mt-1"
            />
          </div>

          <div>
            <Label>{t('skills.category')}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SKILL_CATEGORIES.map(cat => (
                  <SelectItem key={cat} value={cat}>
                    {t(`skills.categories.${cat}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>{t('skills.tags')}</Label>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder={language === 'he' ? 'תגיות מופרדות בפסיקים' : 'Comma-separated tags'}
              className="mt-1"
            />
          </div>

          <div>
            <Label>{t('skills.triggerPattern')}</Label>
            <Input
              value={triggerPattern}
              onChange={(e) => setTriggerPattern(e.target.value)}
              placeholder={language === 'he' ? 'מתי הסקיל מופעל אוטומטית' : 'When the skill auto-activates'}
              className="mt-1"
              dir="ltr"
            />
          </div>

          <div>
            <Label>{t('skills.icon')}</Label>
            <div className="grid grid-cols-8 gap-2 mt-1">
              {SKILL_ICON_OPTIONS.map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setIconName(name)}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center border-2 transition-all hover:bg-primary/10 ${
                    iconName === name ? 'border-primary bg-primary/10' : 'border-border/40'
                  }`}
                  title={name}
                >
                  <SkillIcon iconName={name} className="w-5 h-5 text-primary" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {language === 'he' ? 'ביטול' : 'Cancel'}
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending || !name.trim()}>
            {language === 'he' ? 'שמור' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
