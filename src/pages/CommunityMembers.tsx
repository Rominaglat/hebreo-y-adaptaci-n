import { useState, useEffect, useMemo } from 'react';
import { Users, Phone, MessageCircle, Linkedin, Github, Instagram, Facebook, Loader2, Search, Expand } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { MemberProfileDialog, MemberProfile } from '@/components/MemberProfileDialog';

interface Member {
  id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  role: string;
  show_in_community: boolean;
  show_phone_call: boolean;
  show_whatsapp: boolean;
  profile?: {
    social_links: unknown;
    phone: string | null;
  };
}

export default function CommunityMembers() {
  const { t } = useLanguage();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState<MemberProfile | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const query = searchQuery.trim().toLowerCase();
    return members.filter(
      (m) =>
        m.full_name?.toLowerCase().includes(query) ||
        m.bio?.toLowerCase().includes(query)
    );
  }, [members, searchQuery]);

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      // Profiles are the single source of truth post tenant_memberships drop;
      // visibility columns moved onto profiles.
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select(
          `
          id,
          full_name,
          avatar_url,
          bio,
          phone,
          social_links,
          show_in_community,
          show_phone_call,
          show_whatsapp
        `,
        )
        .eq('show_in_community', true);

      if (error) throw error;

      const userIds = profiles?.map((p) => p.id) || [];

      // Pull role from user_roles (replaces tenant_memberships.role).
      const { data: roleRows } = userIds.length
        ? await supabase
            .from('user_roles')
            .select('user_id, role')
            .in('user_id', userIds)
        : { data: [] as { user_id: string; role: string }[] };

      const rolePriority: Record<string, number> = {
        super_admin: 4,
        admin: 3,
        instructor: 2,
        student: 1,
      };
      const roleByUser = new Map<string, string>();
      for (const r of roleRows || []) {
        const current = roleByUser.get(r.user_id);
        if (!current || (rolePriority[r.role] ?? 0) > (rolePriority[current] ?? 0)) {
          roleByUser.set(r.user_id, r.role);
        }
      }

      const membersWithProfiles: Member[] =
        profiles?.map((p) => ({
          id: p.id,
          user_id: p.id,
          full_name: p.full_name,
          avatar_url: p.avatar_url,
          bio: p.bio,
          phone: p.phone,
          role: roleByUser.get(p.id) || 'student',
          show_in_community: p.show_in_community,
          show_phone_call: p.show_phone_call,
          show_whatsapp: p.show_whatsapp,
          profile: {
            social_links: p.social_links,
            phone: p.phone ?? null,
          },
        })) || [];

      setMembers(membersWithProfiles);
    } catch (error) {
      console.error('Error fetching members:', error);
    } finally {
      setLoading(false);
    }
  };

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

  const getWhatsAppUrl = (phone: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    const message = encodeURIComponent(t('membersPage.whatsappMessage'));
    return `https://wa.me/${cleanPhone}?text=${message}`;
  };

  const getSocialLinks = (member: Member) => {
    const rawLinks = member.profile?.social_links;
    const links = (typeof rawLinks === 'object' && rawLinks !== null ? rawLinks : {}) as Record<string, unknown>;
    return {
      linkedin: typeof links.linkedin === 'string' ? links.linkedin : undefined,
      github: typeof links.github === 'string' ? links.github : undefined,
      instagram: typeof links.instagram === 'string' ? links.instagram : undefined,
      facebook: typeof links.facebook === 'string' ? links.facebook : undefined,
    };
  };

  const hasSocialLinks = (member: Member) => {
    const links = getSocialLinks(member);
    return links.linkedin || links.github || links.instagram || links.facebook;
  };

  const openMemberProfile = (member: Member) => {
    const socialLinks = getSocialLinks(member);
    setSelectedMember({
      id: member.id,
      user_id: member.user_id,
      full_name: member.full_name,
      avatar_url: member.avatar_url,
      bio: member.bio,
      phone: member.phone,
      role: member.role,
      show_phone_call: member.show_phone_call,
      show_whatsapp: member.show_whatsapp,
      social_links: socialLinks,
    });
    setProfileDialogOpen(true);
  };

  return (

      <div className="space-y-6">
        {/* Premium Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-5 sm:p-7">
          <div className="absolute -top-12 -end-12 w-48 h-48 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -start-12 w-48 h-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 mb-1.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md shadow-primary/20">
                  <Users className="w-5 h-5 text-primary-foreground" />
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  {t('nav.communityMembers')}
                </h1>
              </div>
              <p className="text-muted-foreground">
                {t('membersPage.headerSubtitle')}
              </p>
            </div>

            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={t('membersPage.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pe-9 h-11 bg-card border-border/60 focus-visible:ring-primary/30 focus-visible:border-primary/50"
              />
            </div>
          </div>
        </div>

        {/* Members Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <Card key={i} className="overflow-hidden border-border/60">
                <CardContent className="p-6 flex flex-col items-center text-center">
                  <Skeleton className="w-20 h-20 rounded-full mb-4" />
                  <Skeleton className="h-5 w-32 mb-2" />
                  <Skeleton className="h-3 w-full max-w-[200px] mb-2" />
                  <Skeleton className="h-3 w-3/4 max-w-[160px] mb-4" />
                  <div className="flex gap-2 w-full mt-4">
                    <Skeleton className="h-10 flex-1 rounded-md" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredMembers.length === 0 ? (
          <Card className="border-border/60">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-5">
                <Users className="w-10 h-10 text-primary/60" />
              </div>
              <h3 className="text-lg font-semibold">
                {searchQuery.trim()
                  ? t('commandPalette.empty')
                  : t('membersPage.noMembers')}
              </h3>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredMembers.map((member) => {
              const socialLinks = getSocialLinks(member);
              const displayName = member.full_name || t('commandPalette.userFallback');
              const phone = member.phone?.trim() || null;

              return (
                <Card key={member.id} className="overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-300 ease-out-cubic h-full flex flex-col relative group border-border/60">
                  {/* Expand button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    onClick={() => openMemberProfile(member)}
                  >
                    <Expand className="w-4 h-4" />
                  </Button>

                  <CardContent className="p-6 flex flex-col items-center text-center flex-1">
                    {/* Avatar with gradient ring */}
                    <div className="relative mb-4">
                      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary to-accent blur-md opacity-30 group-hover:opacity-50 transition-opacity" />
                      <Avatar className="relative w-20 h-20 ring-2 ring-background shadow-md">
                        <AvatarImage src={member.avatar_url || undefined} />
                        <AvatarFallback className="bg-gradient-to-br from-primary/20 to-accent/20 text-primary text-xl font-bold">
                          {getInitials(displayName)}
                        </AvatarFallback>
                      </Avatar>
                    </div>

                    {/* Name - clickable */}
                    <button
                      onClick={() => openMemberProfile(member)}
                      className="font-semibold text-lg mb-1 hover:text-primary transition-colors cursor-pointer"
                    >
                      {displayName}
                    </button>

                    {/* Bio - fixed height for consistency */}
                    <p className="text-sm text-muted-foreground line-clamp-3 mb-4 min-h-[3.75rem]">
                      {member.bio || '\u00A0'}
                    </p>

                    {/* Social Links - fixed height for consistency */}
                    <div className="flex items-center gap-2 mb-4 min-h-[2rem]">
                      {socialLinks.linkedin && (
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                          <a
                            href={normalizeExternalUrl(socialLinks.linkedin)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="LinkedIn"
                          >
                            <Linkedin className="w-4 h-4" />
                          </a>
                        </Button>
                      )}
                      {socialLinks.github && (
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                          <a
                            href={normalizeExternalUrl(socialLinks.github)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="GitHub"
                          >
                            <Github className="w-4 h-4" />
                          </a>
                        </Button>
                      )}
                      {socialLinks.instagram && (
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                          <a
                            href={normalizeExternalUrl(socialLinks.instagram)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Instagram"
                          >
                            <Instagram className="w-4 h-4" />
                          </a>
                        </Button>
                      )}
                      {socialLinks.facebook && (
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                          <a
                            href={normalizeExternalUrl(socialLinks.facebook)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Facebook"
                          >
                            <Facebook className="w-4 h-4" />
                          </a>
                        </Button>
                      )}
                    </div>

                    {/* Contact Buttons - pushed to bottom with flex-grow spacer */}
                    <div className="flex-1" />
                    <div className="flex gap-2 w-full mt-auto">
                      {phone && (member.show_phone_call || member.show_whatsapp) ? (
                        <>
                          {member.show_phone_call && (
                            <Button asChild className="flex-1">
                              <a href={`tel:${phone.replace(/\D/g, '')}`} aria-label="Call">
                                <Phone className="w-4 h-4" />
                                {t('benefitsPage.call')}
                              </a>
                            </Button>
                          )}
                          {member.show_whatsapp && (
                            <Button
                              asChild
                              className="flex-1 bg-success text-success-foreground hover:bg-success/90"
                            >
                              <a
                                href={getWhatsAppUrl(phone)}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="WhatsApp"
                              >
                                <MessageCircle className="w-4 h-4" />
                                {t('benefitsPage.whatsapp')}
                              </a>
                            </Button>
                          )}
                        </>
                      ) : (
                        <div className="h-10" /> 
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Member Profile Dialog */}
        <MemberProfileDialog
          member={selectedMember}
          open={profileDialogOpen}
          onOpenChange={setProfileDialogOpen}
        />
      </div>
  );
}
