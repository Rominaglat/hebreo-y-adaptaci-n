import { Phone, MessageCircle, Linkedin, Github, Instagram, Facebook, Mail, Expand } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

interface SocialLinks {
  linkedin?: string;
  github?: string;
  instagram?: string;
  facebook?: string;
}

export interface MemberProfile {
  id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  email?: string | null;
  role?: string;
  show_phone_call?: boolean;
  show_whatsapp?: boolean;
  social_links?: SocialLinks;
}

interface MemberProfileDialogProps {
  member: MemberProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MemberProfileDialog({ member, open, onOpenChange }: MemberProfileDialogProps) {
  const { language } = useLanguage();

  if (!member) return null;

  const displayName = member.full_name || (language === 'he' ? 'משתמש' : 'User');
  const phone = member.phone?.trim() || null;

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const normalizeExternalUrl = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed.replace(/^\/+/, '')}`;
  };

  const getWhatsAppUrl = (phoneNum: string) => {
    const cleanPhone = phoneNum.replace(/\D/g, '');
    const message = encodeURIComponent('היי :) הגעתי אליך דרך הקהילה');
    return `https://wa.me/${cleanPhone}?text=${message}`;
  };

  const socialLinks = member.social_links || {};
  const hasSocialLinks = socialLinks.linkedin || socialLinks.github || socialLinks.instagram || socialLinks.facebook;

  const showPhoneCall = member.show_phone_call !== false;
  const showWhatsapp = member.show_whatsapp !== false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">{displayName}</DialogTitle>
        </DialogHeader>
        
        <div className="flex flex-col items-center text-center pt-4">
          {/* Avatar */}
          <Avatar className="w-24 h-24 mb-4">
            <AvatarImage src={member.avatar_url || undefined} />
            <AvatarFallback className="bg-primary/10 text-primary text-2xl">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>

          {/* Name */}
          <h2 className="text-xl font-semibold mb-1">{displayName}</h2>
          
          {/* Role badge */}
          {member.role && member.role !== 'student' && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full mb-3">
              {member.role === 'admin' ? (language === 'he' ? 'מנהל' : 'Admin') :
               member.role === 'instructor' ? (language === 'he' ? 'מרצה' : 'Instructor') :
               member.role === 'super_admin' ? (language === 'he' ? 'מנהל ראשי' : 'Super Admin') :
               member.role}
            </span>
          )}

          {/* Bio */}
          {member.bio && (
            <p className="text-sm text-muted-foreground mb-4 max-w-xs">
              {member.bio}
            </p>
          )}

          {/* Email */}
          {member.email && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Mail className="w-4 h-4" />
              <a href={`mailto:${member.email}`} className="hover:underline">
                {member.email}
              </a>
            </div>
          )}

          {/* Social Links */}
          {hasSocialLinks && (
            <div className="flex items-center gap-2 mb-4">
              {socialLinks.linkedin && (
                <Button asChild variant="ghost" size="icon" className="h-9 w-9">
                  <a
                    href={normalizeExternalUrl(socialLinks.linkedin)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="LinkedIn"
                  >
                    <Linkedin className="w-5 h-5" />
                  </a>
                </Button>
              )}
              {socialLinks.github && (
                <Button asChild variant="ghost" size="icon" className="h-9 w-9">
                  <a
                    href={normalizeExternalUrl(socialLinks.github)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="GitHub"
                  >
                    <Github className="w-5 h-5" />
                  </a>
                </Button>
              )}
              {socialLinks.instagram && (
                <Button asChild variant="ghost" size="icon" className="h-9 w-9">
                  <a
                    href={normalizeExternalUrl(socialLinks.instagram)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Instagram"
                  >
                    <Instagram className="w-5 h-5" />
                  </a>
                </Button>
              )}
              {socialLinks.facebook && (
                <Button asChild variant="ghost" size="icon" className="h-9 w-9">
                  <a
                    href={normalizeExternalUrl(socialLinks.facebook)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Facebook"
                  >
                    <Facebook className="w-5 h-5" />
                  </a>
                </Button>
              )}
            </div>
          )}

          {/* Contact Buttons */}
          {phone && (showPhoneCall || showWhatsapp) && (
            <div className="flex gap-3 w-full max-w-xs">
              {showPhoneCall && (
                <Button asChild className="flex-1">
                  <a href={`tel:${phone.replace(/\D/g, '')}`}>
                    <Phone className="w-4 h-4 mr-2" />
                    {language === 'he' ? 'חייג' : 'Call'}
                  </a>
                </Button>
              )}
              {showWhatsapp && (
                <Button
                  asChild
                  className="flex-1 bg-success text-success-foreground hover:bg-success/90"
                >
                  <a
                    href={getWhatsAppUrl(phone)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="w-4 h-4 mr-2" />
                    {language === 'he' ? 'ווטסאפ' : 'WhatsApp'}
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Expand button component for cards
export function MemberExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Expand className="w-4 h-4" />
    </Button>
  );
}
