import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";


interface AdminActionRequest {
  action: "delete_user" | "reset_password" | "log_activity" | "create_user" | "update_user" | "sync_emails" | "set_access_limit";
  userId?: string;
  newPassword?: string;
  // For set_access_limit: provide EITHER expiresAt (ISO datetime) OR hours
  // (number of hours from now), OR clear:true to remove an existing limit.
  expiresAt?: string;
  hours?: number;
  clear?: boolean;
  activityType?: string;
  activityDescription?: string;
  metadata?: Record<string, any>;
  // For create_user action
  email?: string;
  fullName?: string;
  role?: "admin" | "instructor" | "student";
  tenantId?: string;
  phone?: string;
  // When true on create_user, an EXISTING user with the same email has
  // their password overwritten with newPassword. Default is the legacy
  // idempotent behavior (existing user → no password change). Used by
  // the bulk-import dialog so re-importing the same roster propagates
  // the (newly phone-derived) password.
  overwritePassword?: boolean;
  // For update_user action
  newEmail?: string;
}

// Create a Supabase client for JWT verification
async function verifyAndGetUserId(supabaseUrl: string, supabaseAnonKey: string, token: string): Promise<string | null> {
  try {
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false }
    });
    const { data, error } = await supabaseClient.auth.getUser(token);
    if (error || !data?.user) {
      console.error("JWT verification failed:", error);
      return null;
    }
    return data.user.id;
  } catch (err) {
    console.error("Error verifying JWT:", err);
    return null;
  }
}


// SEC-046 — never log full emails. Mask the local-part to first/last char +
// length. e.g. "jane.doe@example.com" → "j***e@example.com (8)".
function maskEmail(email: unknown): string {
  if (typeof email !== "string") return "<no-email>";
  const at = email.indexOf("@");
  if (at <= 0) return "<malformed-email>";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `***${domain}`;
  return `${local[0]}***${local[local.length - 1]}${domain} (${local.length})`;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract JWT token from Authorization header
    const token = authHeader.replace("Bearer ", "");
    
    // Get Supabase credentials
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Verify the JWT and get the user ID with proper signature verification
    const adminUserId = await verifyAndGetUserId(supabaseUrl, supabaseAnonKey, token);
    if (!adminUserId) {
      console.error("Invalid or expired token");
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Authenticated user ID:", adminUserId);

    // Create service role client for admin operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Pull every role for the requester so we know what they can do.
    // Single-tenant: roles come from `user_roles` only.
    const { data: membershipData, error: roleError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", adminUserId);

    if (roleError || !membershipData || membershipData.length === 0) {
      console.error("Role lookup failed:", roleError, "Roles:", membershipData);
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requesterIsAdmin = membershipData.some(
      (m) => m.role === "admin" || m.role === "super_admin"
    );
    const requesterIsInstructor = membershipData.some((m) => m.role === "instructor");

    if (!requesterIsAdmin && !requesterIsInstructor) {
      return new Response(
        JSON.stringify({ error: "Admin or instructor access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Requester verified:", adminUserId, "admin:", requesterIsAdmin, "instructor:", requesterIsInstructor);

    const { action, userId: targetUserId, newPassword, activityType, activityDescription, metadata, email, fullName, role, tenantId, phone, newEmail, overwritePassword, expiresAt, hours, clear }: AdminActionRequest = await req.json();

    // SEC-026 — audit log helper for sensitive admin actions. Best-effort;
    // log failures must not block the action.
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;
    async function writeAuditLog(
      action: string,
      target: string | null,
      _tenant: string | null,
      before: Record<string, unknown> | null,
      after: Record<string, unknown> | null,
    ): Promise<void> {
      try {
        await adminClient.from("auth_audit_log").insert({
          actor_id: adminUserId,
          target_user_id: target,
          action,
          before,
          after,
          ip: ipAddress,
          user_agent: userAgent,
        });
      } catch (e) {
        console.error("[audit] failed to write auth_audit_log:", e);
      }
    }

    // Instructors can only invoke a narrow set of actions, and only when
    // the target user is a student in a tenant where the instructor is also
    // a member.
    if (!requesterIsAdmin) {
      const INSTRUCTOR_ALLOWED_ACTIONS = new Set(["reset_password", "log_activity"]);
      if (!INSTRUCTOR_ALLOWED_ACTIONS.has(action)) {
        return new Response(
          JSON.stringify({ error: "This action requires admin access" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (action === "reset_password") {
        if (!targetUserId) {
          return new Response(
            JSON.stringify({ error: "User ID is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: targetMemberships, error: targetError } = await adminClient
          .from("user_roles")
          .select("role")
          .eq("user_id", targetUserId);

        if (targetError || !targetMemberships || targetMemberships.length === 0) {
          return new Response(
            JSON.stringify({ error: "Target user not found" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Single-tenant: instructors may only reset passwords for students.
        const targetIsStudent = targetMemberships.some((m) => m.role === "student");

        if (!targetIsStudent) {
          return new Response(
            JSON.stringify({
              error: "Instructors can only reset passwords for students",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    console.log(`Admin action: ${action} for user: ${targetUserId || 'new user'}`);

    switch (action) {
      case "create_user": {
        if (!email || !fullName || !newPassword) {
          return new Response(
            JSON.stringify({ error: "Email, full name, and password are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // First, check if user with this email already exists using profiles table
        // This is more reliable than listUsers which has pagination limits
        const { data: existingProfile } = await adminClient
          .from('profiles')
          .select('id, email')
          .ilike('email', email)
          .maybeSingle();
        
        let existingUser = existingProfile ? { id: existingProfile.id, email: existingProfile.email } : null;

        if (existingUser) {
          // User already exists. Single-tenant: every authenticated user
          // belongs to the one tenant, so the only thing left to do is
          // ensure they have the requested role.
          console.log(`User ${existingUser.id} already exists with email ${maskEmail(email)}`);

          const { data: existingRoleRow } = await adminClient
            .from('user_roles')
            .select('id, role')
            .eq('user_id', existingUser.id)
            .eq('role', role || 'student')
            .maybeSingle();

          // If the caller asked to overwrite the password (e.g. an admin
          // re-importing the same roster with phone-as-password), do that
          // now BEFORE the early-return for already-has-role. SEC: only
          // admins reach this code path (instructors are blocked above),
          // so this matches their existing reset_password capability.
          if (overwritePassword && newPassword) {
            const { error: pwError } = await adminClient.auth.admin.updateUserById(
              existingUser.id,
              { password: newPassword },
            );
            if (pwError) {
              console.error("Error overwriting password for existing user:", pwError);
              return new Response(
                JSON.stringify({ error: "Failed to update password: " + pwError.message }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            console.log(`Password overwritten for existing user ${existingUser.id}`);
          }

          if (existingRoleRow) {
            console.log(`User ${existingUser.id} already has role ${role || 'student'}`);
            return new Response(
              JSON.stringify({
                success: true,
                message: "User already exists with this role",
                userId: existingUser.id,
                alreadyMember: true,
                passwordUpdated: overwritePassword && !!newPassword,
              }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Grant the requested role.
          const { error: roleError } = await adminClient
            .from('user_roles')
            .insert({
              user_id: existingUser.id,
              role: role || 'student',
            });

          if (roleError) {
            console.error("Error granting role to existing user:", roleError);
            return new Response(
              JSON.stringify({ error: "Failed to grant role: " + roleError.message }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Update profile (full_name / phone) if needed.
          await adminClient
            .from('profiles')
            .update({
              full_name: fullName,
              phone: phone || null,
            })
            .eq('id', existingUser.id);

          console.log(`Existing user ${existingUser.id} granted role ${role || 'student'}`);

          return new Response(
            JSON.stringify({
              success: true,
              message: "Existing user added successfully",
              userId: existingUser.id,
              addedToExistingUser: true,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // User doesn't exist - create new user
        const { data: userData, error: createError } = await adminClient.auth.admin.createUser({
          email: email,
          password: newPassword,
          email_confirm: true, // Auto-confirm email
          user_metadata: {
            full_name: fullName
          }
        });

        // Helper: upsert profile + grant role, then return success
        const finalizeUser = async (userId: string, isNew: boolean) => {
          // Ensure profile exists (trigger may not run reliably for admin-created users)
          const { error: profileError } = await adminClient
            .from('profiles')
            .upsert({ id: userId, email: email, full_name: fullName, phone: phone || null });

          if (profileError) {
            console.error("Error upserting profile:", profileError);
            if (isNew) {
              try { await adminClient.auth.admin.deleteUser(userId); } catch {}
            }
            return new Response(
              JSON.stringify({ error: "Failed to create user profile: " + profileError.message }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Grant the requested role (idempotent — skip if already present).
          const desiredRole = role || 'student';
          const { data: existingRoleRow } = await adminClient
            .from('user_roles')
            .select('id')
            .eq('user_id', userId)
            .eq('role', desiredRole)
            .maybeSingle();

          if (!existingRoleRow) {
            const { error: roleInsertError } = await adminClient
              .from('user_roles')
              .insert({ user_id: userId, role: desiredRole });

            if (roleInsertError) {
              console.error("Error granting role:", roleInsertError);
              if (isNew) {
                try { await adminClient.auth.admin.deleteUser(userId); } catch {}
              }
              return new Response(
                JSON.stringify({ error: "Failed to grant role: " + roleInsertError.message }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            console.log(`Role ${desiredRole} granted to user ${userId}`);
          } else {
            console.log(`User ${userId} already has role ${desiredRole}`);
          }

          // Fire the invite email. Best-effort — never fail the user-create
          // operation if mail dispatch hiccups; admins can re-send manually
          // (or click reset_password) if a user reports they didn't receive
          // the welcome email.
          if (email && newPassword) {
            try {
              const inviteUrl = `${supabaseUrl}/functions/v1/send-invite-email`;
              const inviteResp = await fetch(inviteUrl, {
                method: "POST",
                headers: {
                  "Authorization": authHeader,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  email,
                  fullName,
                  tempPassword: newPassword,
                }),
              });
              if (!inviteResp.ok) {
                console.warn(
                  `[create_user] invite email dispatch returned ${inviteResp.status} for ${maskEmail(email)} — user is created, admin can resend manually`,
                );
              }
            } catch (e) {
              console.warn(`[create_user] invite email dispatch error for ${maskEmail(email)}:`, e);
            }
          }

          return new Response(
            JSON.stringify({
              success: true,
              message: isNew ? "User created successfully" : "Existing user added to tenant successfully",
              userId,
              addedToExistingUser: !isNew,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        };

        if (createError) {
          // If user already exists in auth.users (but was missing from profiles table),
          // look them up via the auth admin REST API and recover.
          const alreadyExists =
            createError.message?.includes('already been registered') ||
            createError.message?.includes('already exists') ||
            (createError as any).status === 422;

          if (alreadyExists) {
            console.log(`createUser failed (user exists in auth): ${createError.message}. Looking up by email...`);
            try {
              // CRITICAL: GoTrue's `?email=` admin filter is unreliable — it
              // frequently ignores the filter and returns the first user of
              // the unfiltered list. Taking users[0] blindly here meant we
              // could "recover" onto a COMPLETELY DIFFERENT account, then
              // overwrite its profile email/name (finalizeUser upserts the
              // requested email) and mis-assign its role + enrollments. That
              // corrupted real accounts (e.g. another student's login got
              // relabelled with this email). So we page through and require an
              // EXACT, case-insensitive email match; if none is found we abort
              // rather than touch the wrong account.
              const wanted = email.toLowerCase();
              let foundUser: { id: string; email?: string } | null = null;
              for (let page = 1; page <= 20 && !foundUser; page++) {
                const authRes = await fetch(
                  `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`,
                  {
                    headers: {
                      Authorization: `Bearer ${supabaseServiceKey}`,
                      apikey: supabaseServiceKey,
                    },
                  }
                );
                const authData = await authRes.json();
                const users: Array<{ id: string; email?: string }> = Array.isArray(authData?.users) ? authData.users : [];
                if (users.length === 0) break;
                foundUser = users.find((u) => (u?.email ?? "").toLowerCase() === wanted) ?? null;
              }
              if (foundUser?.id) {
                console.log(`Found existing auth user ${foundUser.id} with matching email, recovering...`);
                return await finalizeUser(foundUser.id, false);
              }
              console.error(`Auth reports ${maskEmail(email)} exists but no exact match was found — aborting to avoid corrupting another account`);
            } catch (lookupErr) {
              console.error("Failed to look up user by email:", lookupErr);
            }
          }

          console.error("Error creating user:", createError);
          return new Response(
            JSON.stringify({ error: createError.message || "Failed to create user" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!userData.user) {
          throw new Error("User creation failed");
        }

        const newUserId = userData.user.id;
        console.log(`User created with ID: ${newUserId}`);
        await writeAuditLog(
          "create_user",
          newUserId,
          tenantId ?? null,
          null,
          { email, full_name: fullName, role, phone: phone ?? null },
        );
        return await finalizeUser(newUserId, true);
      }

      case "delete_user": {
        if (!targetUserId) {
          return new Response(
            JSON.stringify({ error: "User ID is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        // Clear references that can block deleting the auth user due to restrictive foreign keys
        // (platform_settings has been dropped; only developer_settings + community_benefits remain.)
        const { error: developerSettingsError } = await adminClient
          .from("developer_settings")
          .update({ updated_by: null })
          .eq("updated_by", targetUserId);

        if (developerSettingsError) {
          console.error("Error clearing developer_settings.updated_by:", developerSettingsError);
          throw developerSettingsError;
        }

        const { error: communityBenefitsError } = await adminClient
          .from("community_benefits")
          .update({ created_by: null })
          .eq("created_by", targetUserId);

        if (communityBenefitsError) {
          console.error("Error clearing community_benefits.created_by:", communityBenefitsError);
          throw communityBenefitsError;
        }

        // Soft-delete (Wave 4) — keep an audit trail and allow undo for 30 days.
        // Hard-erase happens via a scheduled job (see docs/security/GDPR_DSAR.md).
        //
        // 1. Mark the profile as deleted (so the UI hides it) and scrub PII.
        await adminClient
          .from("profiles")
          .update({
            deleted_at: new Date().toISOString(),
            email: `${targetUserId}@deleted.invalid`,
            full_name: "[deleted user]",
            avatar_url: null,
            phone: null,
            bio: null,
            social_links: null,
          })
          .eq("id", targetUserId);

        // 2. Revoke roles + delete chatty/per-user volatile data
        //    immediately. Course-history tables (enrollments, exam_attempts,
        //    lesson_completions) are kept for 7-year retention with the
        //    profile pointing at a tombstone row — auditable but unattributable.
        await adminClient.from("user_activities").delete().eq("user_id", targetUserId);
        await adminClient.from("user_notes").delete().eq("user_id", targetUserId);
        await adminClient.from("event_rsvps").delete().eq("user_id", targetUserId);
        await adminClient.from("user_roles").delete().eq("user_id", targetUserId);
        await adminClient.from("push_subscriptions").delete().eq("user_id", targetUserId);

        // 3. Ban the auth.users row so the email cannot sign in again, but
        //    keep the row until the 30-day retention window expires.
        const { error: banError } = await adminClient.auth.admin.updateUserById(
          targetUserId,
          {
            ban_duration: "876000h", // ~100 years
            user_metadata: { deleted_at: new Date().toISOString() },
          },
        );
        if (banError) {
          console.error("Error banning user after soft-delete:", banError);
          throw banError;
        }

        console.log(`User ${targetUserId} soft-deleted; hard-erase queued at +30 days`);
        await writeAuditLog("delete_user", targetUserId, tenantId ?? null, null, {
          mode: "soft-delete",
          hard_erase_due: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
        return new Response(
          JSON.stringify({ success: true, message: "User deleted successfully" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "reset_password": {
        if (!targetUserId) {
          return new Response(
            JSON.stringify({ error: "User ID is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        // SEC-014 — server-side minimum mirrors the frontend policy.
        if (!newPassword || newPassword.length < 12) {
          return new Response(
            JSON.stringify({ error: "Password must be at least 12 characters" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
          password: newPassword
        });

        if (updateError) {
          console.error("Error resetting password:", updateError);
          throw updateError;
        }

        // Log activity
        await adminClient.from("user_activities").insert({
          user_id: targetUserId,
          activity_type: "password_reset",
          description: "Password was reset by admin"
        });
        await writeAuditLog("reset_password", targetUserId, tenantId ?? null, null, null);

        console.log(`Password reset for user ${targetUserId}`);
        return new Response(
          JSON.stringify({ success: true, message: "Password reset successfully" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "log_activity": {
        if (!activityType || !activityDescription) {
          return new Response(
            JSON.stringify({ error: "Activity type and description required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error: insertError } = await adminClient.from("user_activities").insert({
          user_id: targetUserId,
          activity_type: activityType,
          description: activityDescription,
          metadata: metadata || {}
        });

        if (insertError) {
          console.error("Error logging activity:", insertError);
          throw insertError;
        }

        return new Response(
          JSON.stringify({ success: true, message: "Activity logged" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "sync_emails": {
        // Sync Auth emails FROM profiles table (profiles -> auth.users)
        // This updates login credentials to match the emails in profiles
        const { data: profiles, error: profilesError } = await adminClient
          .from('profiles')
          .select('id, email');
        
        if (profilesError) {
          console.error("Error fetching profiles:", profilesError);
          return new Response(
            JSON.stringify({ error: "Failed to fetch profiles" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        let syncedCount = 0;
        let errorCount = 0;
        const syncDetails: Array<{userId: string, email: string, status: string}> = [];

        for (const profile of profiles) {
          if (!profile.email) {
            console.log(`Skipping user ${profile.id} - no email in profile`);
            continue;
          }

          try {
            // Get current auth user email
            const { data: authUser, error: getUserError } = await adminClient.auth.admin.getUserById(profile.id);
            
            if (getUserError || !authUser?.user) {
              console.error(`Error fetching auth user ${profile.id}:`, getUserError);
              errorCount++;
              syncDetails.push({ userId: profile.id, email: profile.email, status: 'error_fetch' });
              continue;
            }

            // Only update if emails differ
            if (authUser.user.email !== profile.email) {
              console.log(`Updating auth email for user ${profile.id}: ${maskEmail(authUser.user.email)} -> ${maskEmail(profile.email)}`);
              
              const { error: updateError } = await adminClient.auth.admin.updateUserById(profile.id, {
                email: profile.email,
                email_confirm: true
              });

              if (updateError) {
                console.error(`Error updating auth email for user ${profile.id}:`, updateError);
                errorCount++;
                syncDetails.push({ userId: profile.id, email: profile.email, status: 'error_update: ' + updateError.message });
              } else {
                syncedCount++;
                syncDetails.push({ userId: profile.id, email: profile.email, status: 'synced' });
              }
            } else {
              // Already in sync
              syncDetails.push({ userId: profile.id, email: profile.email, status: 'already_synced' });
            }
          } catch (err) {
            console.error(`Unexpected error for user ${profile.id}:`, err);
            errorCount++;
            syncDetails.push({ userId: profile.id, email: profile.email, status: 'error_unexpected' });
          }
        }

        console.log(`Synced ${syncedCount} emails, ${errorCount} errors`);
        return new Response(
          JSON.stringify({ success: true, synced: syncedCount, errors: errorCount, details: syncDetails }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "update_user": {
        if (!targetUserId) {
          return new Response(
            JSON.stringify({ error: "User ID is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Update auth email if provided
        if (newEmail) {
          const nextEmail = newEmail.trim();
          const emailIsValid =
            nextEmail.length > 3 &&
            nextEmail.length <= 255 &&
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail);

          if (!emailIsValid) {
            return new Response(
              JSON.stringify({ error: "Invalid email" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const { data: authUserRes, error: getAuthUserError } = await adminClient.auth.admin.getUserById(targetUserId);

          if (getAuthUserError || !authUserRes?.user) {
            console.error("Error fetching auth user:", getAuthUserError);
            return new Response(
              JSON.stringify({ error: "Failed to fetch user" }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const currentEmail = (authUserRes.user.email || '').trim().toLowerCase();
          const desiredEmail = nextEmail.toLowerCase();

          if (currentEmail !== desiredEmail) {
            const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
              email: nextEmail,
              email_confirm: true // Auto-confirm the new email
            });

            if (authUpdateError) {
              console.error("Error updating auth email:", authUpdateError);
              return new Response(
                JSON.stringify({ error: "Failed to update email: " + authUpdateError.message }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }

          // Ensure profiles table matches the desired email
          const { error: profileUpdateError } = await adminClient
            .from('profiles')
            .update({ email: nextEmail })
            .eq('id', targetUserId);

          if (profileUpdateError) {
            console.error("Error updating profile email:", profileUpdateError);
            // Don't fail - login email may already be updated
          }

          console.log(`Email ensured for user ${targetUserId} -> ${maskEmail(nextEmail)} (auth updated: ${currentEmail !== desiredEmail})`);
        }

        // Update profile fields if provided (single-tenant: stored in profiles)
        if (fullName || phone !== undefined) {
          const updateData: Record<string, any> = {};
          if (fullName) updateData.full_name = fullName;
          if (phone !== undefined) updateData.phone = phone || null;

          if (Object.keys(updateData).length > 0) {
            const { error: profileUpdateError } = await adminClient
              .from('profiles')
              .update(updateData)
              .eq('id', targetUserId);

            if (profileUpdateError) {
              console.error("Error updating profile:", profileUpdateError);
              return new Response(
                JSON.stringify({ error: "Failed to update user profile: " + profileUpdateError.message }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            console.log(`Profile updated for user ${targetUserId}`);
          }
        }

        return new Response(
          JSON.stringify({ success: true, message: "User updated successfully" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "set_access_limit": {
        // Admin-only (instructors never reach unlisted actions). Sets/clears a
        // time-limited-access row for a student/lead. When it expires, a
        // server-side sweep deletes their enrollments and downgrades them to
        // 'lead' (migration 20260623120000_access_time_limit).
        if (!requesterIsAdmin) {
          return new Response(
            JSON.stringify({ error: "This action requires admin access" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (!targetUserId) {
          return new Response(
            JSON.stringify({ error: "User ID is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Only students/leads may be time-limited — never admins/instructors.
        const { data: targetRoles, error: targetRolesError } = await adminClient
          .from("user_roles")
          .select("role")
          .eq("user_id", targetUserId);

        if (targetRolesError) {
          console.error("Error fetching target roles:", targetRolesError);
          throw targetRolesError;
        }
        const targetIsPrivileged = (targetRoles || []).some(
          (r) => r.role === "admin" || r.role === "super_admin" || r.role === "instructor"
        );
        if (targetIsPrivileged) {
          return new Response(
            JSON.stringify({ error: "Time limit can only be set for students and leads" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Clear an existing limit.
        if (clear === true) {
          const { error: delError } = await adminClient
            .from("access_limits")
            .delete()
            .eq("user_id", targetUserId);
          if (delError) {
            console.error("Error clearing access limit:", delError);
            throw delError;
          }
          await writeAuditLog("clear_access_limit", targetUserId, tenantId ?? null, null, null);
          return new Response(
            JSON.stringify({ success: true, message: "Access limit removed", expiresAt: null }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Resolve expiry: explicit ISO datetime, else hours-from-now.
        let expiresAtIso: string;
        if (expiresAt) {
          const d = new Date(expiresAt);
          if (isNaN(d.getTime())) {
            return new Response(
              JSON.stringify({ error: "Invalid expiresAt" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          if (d.getTime() <= Date.now()) {
            return new Response(
              JSON.stringify({ error: "expiresAt must be in the future" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          expiresAtIso = d.toISOString();
        } else if (hours !== undefined && hours !== null) {
          const h = Number(hours);
          if (!Number.isFinite(h) || h <= 0) {
            return new Response(
              JSON.stringify({ error: "hours must be a positive number" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          expiresAtIso = new Date(Date.now() + h * 3600_000).toISOString();
        } else {
          return new Response(
            JSON.stringify({ error: "Provide expiresAt, hours, or clear" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error: upsertError } = await adminClient
          .from("access_limits")
          .upsert({
            user_id: targetUserId,
            expires_at: expiresAtIso,
            revoked_at: null,
            created_by: adminUserId,
            source: "admin",
            updated_at: new Date().toISOString(),
          });
        if (upsertError) {
          console.error("Error setting access limit:", upsertError);
          throw upsertError;
        }

        await writeAuditLog("set_access_limit", targetUserId, tenantId ?? null, null, {
          expires_at: expiresAtIso,
        });
        console.log(`Access limit set for user ${targetUserId} → ${expiresAtIso}`);
        return new Response(
          JSON.stringify({ success: true, message: "Access limit set", expiresAt: expiresAtIso }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Invalid action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error: any) {
    console.error("Error in admin-user-actions:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
