import {
  Sparkles,
  Code2,
  Wrench,
  TestTube2,
  FileText,
  Shield,
  Palette,
  Database,
  Bot,
  Zap,
  BookOpen,
  Terminal,
  GitBranch,
  Cloud,
  Lock,
  Search,
  Bug,
  Package,
  Globe,
  type LucideIcon,
} from 'lucide-react';

export const SKILL_ICON_MAP: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  code: Code2,
  wrench: Wrench,
  test: TestTube2,
  document: FileText,
  shield: Shield,
  design: Palette,
  data: Database,
  bot: Bot,
  zap: Zap,
  book: BookOpen,
  terminal: Terminal,
  git: GitBranch,
  cloud: Cloud,
  lock: Lock,
  search: Search,
  bug: Bug,
  package: Package,
  globe: Globe,
};

// Default icon per category — used when icon_name is null
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  general: Sparkles,
  coding: Code2,
  devops: Cloud,
  testing: TestTube2,
  documentation: FileText,
  security: Shield,
  design: Palette,
  data: Database,
};

export const SKILL_ICON_OPTIONS = Object.keys(SKILL_ICON_MAP);

interface SkillIconProps {
  iconName?: string | null;
  category?: string;
  className?: string;
}

export function SkillIcon({ iconName, category, className }: SkillIconProps) {
  const Icon =
    (iconName && SKILL_ICON_MAP[iconName]) ||
    (category && CATEGORY_ICONS[category]) ||
    Sparkles;
  return <Icon className={className} />;
}
