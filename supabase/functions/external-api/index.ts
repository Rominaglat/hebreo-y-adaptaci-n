import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";


interface ApiRequest {
  action: string;
  data?: Record<string, any>;
}

interface DeveloperSettings {
  api_key: string;
  rate_limit_per_minute: number;
  rate_limit_enabled: boolean;
}

// Hash API key for storage (don't store raw key in logs)
function hashApiKey(apiKey: string): string {
  if (apiKey.length > 12) {
    return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
  }
  return apiKey.slice(0, 4) + '...';
}

// Log API request
async function logRequest(
  supabase: any,
  apiKeyHash: string,
  action: string,
  statusCode: number,
  responseTimeMs: number,
  errorMessage: string | null,
  requestData: any,
  ipAddress: string | null,
  userAgent: string | null
) {
  try {
    const { error } = await supabase.from('api_request_logs').insert({
      api_key_hash: apiKeyHash,
      action,
      status_code: statusCode,
      response_time_ms: responseTimeMs,
      error_message: errorMessage,
      request_data: requestData ? JSON.stringify(requestData).slice(0, 1000) : null,
      ip_address: ipAddress,
      user_agent: userAgent
    });
    if (error) {
      console.error('Failed to log API request:', error);
    }
  } catch (error) {
    console.error('Failed to log API request:', error);
  }
}

// Check rate limit
async function checkRateLimit(
  supabase: any,
  apiKeyHash: string,
  limitPerMinute: number
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('api_request_logs')
    .select('id', { count: 'exact', head: true })
    .eq('api_key_hash', apiKeyHash)
    .gte('created_at', oneMinuteAgo);

  if (error) {
    console.error('Rate limit check error:', error);
    return { allowed: true, remaining: limitPerMinute, resetAt: new Date(Date.now() + 60000) };
  }

  const requestCount = count || 0;
  const remaining = Math.max(0, limitPerMinute - requestCount);
  const resetAt = new Date(Date.now() + 60000);

  return {
    allowed: requestCount < limitPerMinute,
    remaining,
    resetAt
  };
}


// Single-tenant build: no per-row ownership checks against a tenant_id are
// needed — every resource belongs to the one tenant. Existence checks remain
// where they protect against bad IDs from the caller.

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  function jsonResponse(data: any, status = 200) {
    return new Response(
      JSON.stringify(data),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  function errorResponse(message: string, code: string, status = 400) {
    return new Response(
      JSON.stringify({ error: message, code }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const startTime = Date.now();

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get request metadata for logging
  const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null;
  const userAgent = req.headers.get('user-agent');

  let apiKeyHash = 'unknown';
  let action = 'unknown';
  let requestData: any = null;

  // Helper to send response with logging
  async function sendResponse(response: Response, errorMsg: string | null = null) {
    const responseTime = Date.now() - startTime;
    await logRequest(supabase, apiKeyHash, action, response.status, responseTime, errorMsg, requestData, ipAddress, userAgent);
    return response;
  }

  try {
    // Validate API key
    const apiKey = req.headers.get('X-API-Key');
    if (!apiKey) {
      console.warn(`[API] Missing API key from ${ipAddress}`);
      return await sendResponse(
        jsonResponse({ error: 'Missing API key', code: 'UNAUTHORIZED' }, 401),
        'Missing API key'
      );
    }

    apiKeyHash = hashApiKey(apiKey);

    // Single-tenant: the API key the admin generates in PlatformSettings
    // lands in tenant_settings.api_key (via the DeveloperSettings component).
    // The legacy developer_settings table is unused and sits empty, so a
    // lookup there was always returning null and 401'ing every caller.
    // We check tenant_settings first; developer_settings stays as a
    // back-compat fallback in case anyone still writes there.
    let isValidKey = false;
    let rateLimitEnabled = false;
    let rateLimitPerMinute = 60;

    const { data: tenantSettings } = await supabase
      .from('tenant_settings')
      .select('api_key')
      .limit(1)
      .maybeSingle();

    if (tenantSettings && tenantSettings.api_key === apiKey) {
      isValidKey = true;
    } else {
      // Legacy path — read from developer_settings if someone populates it.
      const { data: devSettings } = await supabase
        .from('developer_settings')
        .select('api_key, rate_limit_per_minute, rate_limit_enabled')
        .maybeSingle();
      if (devSettings && devSettings.api_key === apiKey) {
        isValidKey = true;
        rateLimitEnabled = devSettings.rate_limit_enabled || false;
        rateLimitPerMinute = devSettings.rate_limit_per_minute || 60;
      }
    }

    if (!isValidKey) {
      console.warn(`[API] Invalid API key attempt: ${apiKeyHash} from ${ipAddress}`);
      return await sendResponse(
        jsonResponse({ error: 'Invalid API key', code: 'UNAUTHORIZED' }, 401),
        'Invalid API key'
      );
    }

    // Check rate limit
    if (rateLimitEnabled) {
      const rateLimit = await checkRateLimit(supabase, apiKeyHash, rateLimitPerMinute);

      if (!rateLimit.allowed) {
        console.warn(`[API] Rate limit exceeded for ${apiKeyHash}`);
        return await sendResponse(
          new Response(
            JSON.stringify({
              error: 'Rate limit exceeded',
              code: 'RATE_LIMITED',
              retry_after: Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000)
            }),
            {
              status: 429,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'X-RateLimit-Limit': String(rateLimitPerMinute),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt.getTime() / 1000)),
                'Retry-After': String(Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000))
              }
            }
          ),
          'Rate limit exceeded'
        );
      }
    }

    // Parse request body
    const body: ApiRequest = await req.json();
    action = body.action || 'unknown';
    requestData = body.data;
    const data = body.data;

    console.log(`[API] Request: ${action} from ${apiKeyHash} (${ipAddress})`);

    // Route to appropriate handler
    switch (action) {
      // ===== USERS =====
      case 'users.list': {
        const { data: users, error } = await supabase
          .from('profiles')
          .select('id, email, full_name, avatar_url, join_date, created_at')
          .order('created_at', { ascending: false })
          .limit(data?.limit || 100);

        if (error) throw error;
        return await sendResponse(jsonResponse({ users }));
      }

      case 'users.get': {
        if (!data?.user_id) {
          return await sendResponse(errorResponse('user_id is required', 'VALIDATION_ERROR'), 'user_id is required');
        }

        const { data: user, error } = await supabase
          .from('profiles')
          .select('id, email, full_name, avatar_url, bio, join_date, created_at')
          .eq('id', data.user_id)
          .single();

        if (error) throw error;
        return await sendResponse(jsonResponse({ user }));
      }

      case 'users.getRoles': {
        if (!data?.user_id) {
          return await sendResponse(errorResponse('user_id is required', 'VALIDATION_ERROR'), 'user_id is required');
        }

        const { data: roles, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', data.user_id);

        if (error) throw error;
        return await sendResponse(jsonResponse({ roles: roles.map(r => r.role) }));
      }

      case 'users.setRole': {
        if (!data?.user_id || !data?.role) {
          return await sendResponse(errorResponse('user_id and role are required', 'VALIDATION_ERROR'), 'user_id and role are required');
        }
        const validRoles = ['admin', 'instructor', 'student'];
        if (!validRoles.includes(data.role)) {
          return await sendResponse(errorResponse(`Invalid role. Must be one of: ${validRoles.join(', ')}`, 'VALIDATION_ERROR'), 'Invalid role');
        }

        const { error: deleteError } = await supabase
          .from('user_roles')
          .delete()
          .eq('user_id', data.user_id);

        if (deleteError) throw deleteError;

        const { error: insertError } = await supabase
          .from('user_roles')
          .insert({ user_id: data.user_id, role: data.role });

        if (insertError) throw insertError;
        return await sendResponse(jsonResponse({ success: true, message: `Role set to ${data.role}` }));
      }

      case 'users.create': {
        if (!data?.email || !data?.password) {
          return await sendResponse(errorResponse('email and password are required', 'VALIDATION_ERROR'), 'email and password are required');
        }
        if (data.password.length < 6) {
          return await sendResponse(errorResponse('Password must be at least 6 characters', 'VALIDATION_ERROR'), 'Password too short');
        }

        const fullName = data.full_name || data.name || data.email;

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email: data.email,
          password: data.password,
          email_confirm: true,
          user_metadata: { full_name: fullName }
        });

        if (authError) {
          if (authError.message.includes('already')) {
            return await sendResponse(errorResponse('User with this email already exists', 'CONFLICT'), 'User already exists');
          }
          throw authError;
        }

        const userId = authData.user.id;

        // Upsert profile — admin.createUser does NOT reliably fire the
        // public.profiles trigger, so a plain .update() leaves no row
        // and the user vanishes from Manage Users (which reads from
        // profiles). Upsert guarantees the row exists either way.
        const { error: profileError } = await supabase.from('profiles').upsert({
          id: userId,
          email: data.email,
          full_name: fullName,
          phone: data.phone || null,
        });
        if (profileError) {
          console.error('[API users.create] profile upsert failed:', profileError);
        }

        // Grant the requested role (default student). 'lead' was missing
        // from the whitelist — adding it so the API can mint preview/
        // sales accounts directly.
        const allowedRoles = ['admin', 'instructor', 'student', 'lead'];
        const resolvedRole = data.role && allowedRoles.includes(data.role) ? data.role : 'student';
        await supabase.from('user_roles').delete().eq('user_id', userId);
        await supabase.from('user_roles').insert({ user_id: userId, role: resolvedRole });

        // Handle course enrollments
        if (data.courses) {
          let courseIds: string[] = [];

          if (data.courses === 'all') {
            const { data: allCourses } = await supabase
              .from('courses')
              .select('id')
              .eq('is_published', true);
            courseIds = allCourses?.map(c => c.id) || [];
          } else if (Array.isArray(data.courses)) {
            courseIds = data.courses;
          }

          if (courseIds.length > 0) {
            const enrollments = courseIds.map(courseId => ({
              user_id: userId,
              course_id: courseId,
              progress_percentage: 0,
            }));
            await supabase.from('enrollments').insert(enrollments);
          }
        }

        // Fire the invite email (best-effort — never fail the create on
        // mail dispatch). admin-user-actions' dashboard path does the
        // same. We send X-Internal-Secret because the external-api
        // caller doesn't have a user JWT, and send-invite-email is
        // normally JWT-gated to admin/instructor.
        const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
        if (internalSecret) {
          try {
            const inviteResp = await fetch(`${supabaseUrl}/functions/v1/send-invite-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-internal-secret': internalSecret,
              },
              body: JSON.stringify({
                email: data.email,
                fullName,
                tempPassword: data.password,
              }),
            });
            if (!inviteResp.ok) {
              console.warn(
                `[API users.create] invite email dispatch returned ${inviteResp.status} for ${hashApiKey(data.email)} — user is created, admin can resend manually`,
              );
            }
          } catch (e) {
            console.warn('[API users.create] invite email dispatch error:', e);
          }
        } else {
          console.warn('[API users.create] INTERNAL_FUNCTION_SECRET not configured — no invite email sent');
        }

        return await sendResponse(jsonResponse({
          user: {
            id: userId,
            email: authData.user.email,
            full_name: fullName,
            phone: data.phone || null,
            role: resolvedRole,
          },
          message: 'User created successfully',
        }));
      }

      case 'users.search': {
        // Build query based on search parameters
        let query = supabase.from('profiles').select('id, email, full_name, avatar_url, phone, join_date, created_at');

        // Apply search filters
        if (data?.email) {
          query = query.ilike('email', `%${data.email}%`);
        }
        if (data?.name || data?.full_name) {
          query = query.ilike('full_name', `%${data.name || data.full_name}%`);
        }
        if (data?.phone) {
          query = query.ilike('phone', `%${data.phone}%`);
        }

        // Apply pagination
        const limit = data?.limit || 50;
        const offset = data?.offset || 0;
        query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

        const { data: users, error } = await query;

        if (error) throw error;

        return await sendResponse(jsonResponse({ users, total: users?.length || 0 }));
      }

      case 'users.delete': {
        if (!data?.user_id) {
          return await sendResponse(errorResponse('user_id is required', 'VALIDATION_ERROR'), 'user_id is required');
        }

        const { error } = await supabase.auth.admin.deleteUser(data.user_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'User deleted' }));
      }

      case 'users.updatePassword': {
        if (!data?.user_id || !data?.password) {
          return await sendResponse(errorResponse('user_id and password are required', 'VALIDATION_ERROR'), 'user_id and password are required');
        }
        if (data.password.length < 6) {
          return await sendResponse(errorResponse('Password must be at least 6 characters', 'VALIDATION_ERROR'), 'Password too short');
        }

        const { error } = await supabase.auth.admin.updateUserById(data.user_id, { password: data.password });
        if (error) throw error;

        return await sendResponse(jsonResponse({ success: true, message: 'Password updated' }));
      }

      // ===== COURSES =====
      case 'courses.list': {
        const { data: courses, error } = await supabase
          .from('courses')
          .select('id, title, description, thumbnail_url, is_published, created_at, updated_at')
          .order('order_index', { ascending: true });

        if (error) throw error;
        return await sendResponse(jsonResponse({ courses }));
      }

      case 'courses.get': {
        if (!data?.course_id) {
          return await sendResponse(errorResponse('course_id is required', 'VALIDATION_ERROR'), 'course_id is required');
        }

        const { data: course, error } = await supabase
          .from('courses')
          .select(`id, title, description, thumbnail_url, is_published, payment_url, created_at, updated_at,
            modules(id, title, description, order_index, lessons(id, title, lesson_type, duration_minutes, order_index))`)
          .eq('id', data.course_id)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return await sendResponse(errorResponse('Course not found', 'NOT_FOUND', 404), 'Course not found');
          }
          throw error;
        }
        return await sendResponse(jsonResponse({ course }));
      }

      case 'courses.create': {
        if (!data?.title) {
          return await sendResponse(errorResponse('title is required', 'VALIDATION_ERROR'), 'title is required');
        }

        const { data: maxOrder } = await supabase.from('courses').select('order_index').order('order_index', { ascending: false }).limit(1).single();

        const insertData: Record<string, any> = {
          title: data.title,
          description: data.description || null,
          thumbnail_url: data.thumbnail_url || null,
          payment_url: data.payment_url || null,
          is_published: data.is_published || false,
          order_index: (maxOrder?.order_index || 0) + 1,
        };

        const { data: course, error } = await supabase
          .from('courses')
          .insert(insertData)
          .select()
          .single();

        if (error) throw error;
        return await sendResponse(jsonResponse({ course, message: 'Course created' }));
      }

      case 'courses.update': {
        if (!data?.course_id) {
          return await sendResponse(errorResponse('course_id is required', 'VALIDATION_ERROR'), 'course_id is required');
        }

        const updateData: Record<string, any> = {};
        if (data.title !== undefined) updateData.title = data.title;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.thumbnail_url !== undefined) updateData.thumbnail_url = data.thumbnail_url;
        if (data.payment_url !== undefined) updateData.payment_url = data.payment_url;
        if (data.is_published !== undefined) updateData.is_published = data.is_published;
        if (data.order_index !== undefined) updateData.order_index = data.order_index;

        const { data: course, error } = await supabase.from('courses').update(updateData).eq('id', data.course_id).select().single();

        if (error) throw error;
        return await sendResponse(jsonResponse({ course, message: 'Course updated' }));
      }

      case 'courses.delete': {
        if (!data?.course_id) {
          return await sendResponse(errorResponse('course_id is required', 'VALIDATION_ERROR'), 'course_id is required');
        }

        const { error } = await supabase.from('courses').delete().eq('id', data.course_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Course deleted' }));
      }

      case 'courses.publish': {
        if (!data?.course_id) {
          return await sendResponse(errorResponse('course_id is required', 'VALIDATION_ERROR'), 'course_id is required');
        }

        const { error } = await supabase.from('courses').update({ is_published: true }).eq('id', data.course_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Course published' }));
      }

      case 'courses.unpublish': {
        if (!data?.course_id) {
          return await sendResponse(errorResponse('course_id is required', 'VALIDATION_ERROR'), 'course_id is required');
        }

        const { error } = await supabase.from('courses').update({ is_published: false }).eq('id', data.course_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Course unpublished' }));
      }

      // ===== MODULES =====
      case 'modules.list': {
        if (!data?.course_id) {
          return await sendResponse(errorResponse('course_id is required', 'VALIDATION_ERROR'), 'course_id is required');
        }

        const { data: modules, error } = await supabase.from('modules').select('id, title, description, order_index, created_at').eq('course_id', data.course_id).order('order_index', { ascending: true });
        if (error) throw error;
        return await sendResponse(jsonResponse({ modules }));
      }

      case 'modules.create': {
        if (!data?.course_id || !data?.title) {
          return await sendResponse(errorResponse('course_id and title are required', 'VALIDATION_ERROR'), 'course_id and title are required');
        }

        const { data: maxOrder } = await supabase.from('modules').select('order_index').eq('course_id', data.course_id).order('order_index', { ascending: false }).limit(1).single();

        const { data: module, error } = await supabase.from('modules').insert({
          course_id: data.course_id,
          title: data.title,
          description: data.description || null,
          order_index: (maxOrder?.order_index || 0) + 1
        }).select().single();

        if (error) throw error;
        return await sendResponse(jsonResponse({ module, message: 'Module created' }));
      }

      case 'modules.update': {
        if (!data?.module_id) {
          return await sendResponse(errorResponse('module_id is required', 'VALIDATION_ERROR'), 'module_id is required');
        }

        const updateData: Record<string, any> = {};
        if (data.title !== undefined) updateData.title = data.title;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.order_index !== undefined) updateData.order_index = data.order_index;

        const { data: module, error } = await supabase.from('modules').update(updateData).eq('id', data.module_id).select().single();
        if (error) throw error;
        return await sendResponse(jsonResponse({ module, message: 'Module updated' }));
      }

      case 'modules.delete': {
        if (!data?.module_id) {
          return await sendResponse(errorResponse('module_id is required', 'VALIDATION_ERROR'), 'module_id is required');
        }

        const { error } = await supabase.from('modules').delete().eq('id', data.module_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Module deleted' }));
      }

      // ===== LESSONS =====
      case 'lessons.list': {
        if (!data?.module_id) {
          return await sendResponse(errorResponse('module_id is required', 'VALIDATION_ERROR'), 'module_id is required');
        }

        const { data: lessons, error } = await supabase.from('lessons').select('*').eq('module_id', data.module_id).order('order_index', { ascending: true });
        if (error) throw error;
        return await sendResponse(jsonResponse({ lessons }));
      }

      case 'lessons.create': {
        if (!data?.module_id || !data?.title) {
          return await sendResponse(errorResponse('module_id and title are required', 'VALIDATION_ERROR'), 'module_id and title are required');
        }

        const { data: maxOrder } = await supabase.from('lessons').select('order_index').eq('module_id', data.module_id).order('order_index', { ascending: false }).limit(1).single();

        const { data: lesson, error } = await supabase.from('lessons').insert({
          module_id: data.module_id,
          title: data.title,
          lesson_type: data.lesson_type || 'video',
          video_url: data.video_url || null,
          embed_url: data.embed_url || null,
          content_text: data.content_text || null,
          file_url: data.file_url || null,
          resources_url: data.resources_url || null,
          duration_minutes: data.duration_minutes || null,
          order_index: (maxOrder?.order_index || 0) + 1
        }).select().single();

        if (error) throw error;
        return await sendResponse(jsonResponse({ lesson, message: 'Lesson created' }));
      }

      case 'lessons.update': {
        if (!data?.lesson_id) {
          return await sendResponse(errorResponse('lesson_id is required', 'VALIDATION_ERROR'), 'lesson_id is required');
        }

        const updateData: Record<string, any> = {};
        if (data.title !== undefined) updateData.title = data.title;
        if (data.lesson_type !== undefined) updateData.lesson_type = data.lesson_type;
        if (data.video_url !== undefined) updateData.video_url = data.video_url;
        if (data.embed_url !== undefined) updateData.embed_url = data.embed_url;
        if (data.content_text !== undefined) updateData.content_text = data.content_text;
        if (data.file_url !== undefined) updateData.file_url = data.file_url;
        if (data.resources_url !== undefined) updateData.resources_url = data.resources_url;
        if (data.duration_minutes !== undefined) updateData.duration_minutes = data.duration_minutes;
        if (data.order_index !== undefined) updateData.order_index = data.order_index;

        const { data: lesson, error } = await supabase.from('lessons').update(updateData).eq('id', data.lesson_id).select().single();
        if (error) throw error;
        return await sendResponse(jsonResponse({ lesson, message: 'Lesson updated' }));
      }

      case 'lessons.delete': {
        if (!data?.lesson_id) {
          return await sendResponse(errorResponse('lesson_id is required', 'VALIDATION_ERROR'), 'lesson_id is required');
        }

        const { error } = await supabase.from('lessons').delete().eq('id', data.lesson_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Lesson deleted' }));
      }

      // ===== ENROLLMENTS =====
      case 'enrollments.list': {
        let query = supabase.from('enrollments').select(`id, user_id, course_id, progress_percentage, enrolled_at, profiles:user_id(full_name, email), courses:course_id(title)`).order('enrolled_at', { ascending: false });

        if (data?.user_id) query = query.eq('user_id', data.user_id);
        if (data?.course_id) query = query.eq('course_id', data.course_id);

        const { data: enrollments, error } = await query.limit(data?.limit || 100);
        if (error) throw error;
        return await sendResponse(jsonResponse({ enrollments }));
      }

      case 'enrollments.create': {
        if (!data?.user_id || !data?.course_id) {
          return await sendResponse(errorResponse('user_id and course_id are required', 'VALIDATION_ERROR'), 'user_id and course_id are required');
        }

        const { data: existing } = await supabase.from('enrollments').select('id').eq('user_id', data.user_id).eq('course_id', data.course_id).single();
        if (existing) {
          return await sendResponse(errorResponse('User is already enrolled in this course', 'CONFLICT'), 'Already enrolled');
        }

        const insertData: Record<string, any> = {
          user_id: data.user_id,
          course_id: data.course_id,
        };

        const { data: enrollment, error } = await supabase.from('enrollments').insert(insertData).select().single();
        if (error) throw error;
        return await sendResponse(jsonResponse({ enrollment, message: 'User enrolled successfully' }));
      }

      case 'enrollments.delete': {
        if (!data?.user_id || !data?.course_id) {
          return await sendResponse(errorResponse('user_id and course_id are required', 'VALIDATION_ERROR'), 'user_id and course_id are required');
        }

        const { error } = await supabase.from('enrollments').delete().eq('user_id', data.user_id).eq('course_id', data.course_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Enrollment removed' }));
      }

      case 'enrollments.updateProgress': {
        if (!data?.user_id || !data?.course_id || data?.progress_percentage === undefined) {
          return await sendResponse(errorResponse('user_id, course_id and progress_percentage are required', 'VALIDATION_ERROR'), 'Missing fields');
        }

        const { error } = await supabase.from('enrollments').update({ progress_percentage: data.progress_percentage }).eq('user_id', data.user_id).eq('course_id', data.course_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Progress updated' }));
      }

      // ===== ACTIVITIES =====
      case 'activities.list': {
        let query = supabase.from('user_activities').select('*').order('created_at', { ascending: false });
        if (data?.user_id) query = query.eq('user_id', data.user_id);
        if (data?.activity_type) query = query.eq('activity_type', data.activity_type);
        if (data?.from_date) query = query.gte('created_at', data.from_date);
        if (data?.to_date) query = query.lte('created_at', data.to_date);
        const { data: activities, error } = await query.limit(data?.limit || 100);
        if (error) throw error;
        return await sendResponse(jsonResponse({ activities }));
      }

      // ===== ANNOUNCEMENTS =====
      case 'announcements.list': {
        const { data: announcements, error } = await supabase
          .from('announcements')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return await sendResponse(jsonResponse({ announcements }));
      }

      case 'announcements.create': {
        if (!data?.title || !data?.content) {
          return await sendResponse(errorResponse('title and content are required', 'VALIDATION_ERROR'), 'title and content are required');
        }

        const insertData: Record<string, any> = {
          title: data.title,
          content: data.content,
          is_pinned: data.is_pinned || false,
          author_id: data.author_id || null,
        };

        const { data: announcement, error } = await supabase.from('announcements').insert(insertData).select().single();
        if (error) throw error;
        return await sendResponse(jsonResponse({ announcement, message: 'Announcement created' }));
      }

      case 'announcements.delete': {
        if (!data?.announcement_id) {
          return await sendResponse(errorResponse('announcement_id is required', 'VALIDATION_ERROR'), 'announcement_id is required');
        }

        const { error } = await supabase.from('announcements').delete().eq('id', data.announcement_id);
        if (error) throw error;
        return await sendResponse(jsonResponse({ success: true, message: 'Announcement deleted' }));
      }

      // ===== EVENTS =====
      case 'events.list': {
        const { data: events, error } = await supabase
          .from('events')
          .select('*')
          .order('start_time', { ascending: true });
        if (error) throw error;
        return await sendResponse(jsonResponse({ events }));
      }

      case 'events.create': {
        if (!data?.title || !data?.start_time || !data?.end_time) {
          return await sendResponse(errorResponse('title, start_time and end_time are required', 'VALIDATION_ERROR'), 'Missing required fields');
        }

        const insertData: Record<string, any> = {
          title: data.title,
          description: data.description || null,
          start_time: data.start_time,
          end_time: data.end_time,
          location: data.location || null,
          meeting_url: data.meeting_url || null,
          created_by: data.created_by || null,
        };

        const { data: event, error } = await supabase.from('events').insert(insertData).select().single();
        if (error) throw error;
        return await sendResponse(jsonResponse({ event, message: 'Event created' }));
      }

      // ===== STATS =====
      case 'stats.overview': {
        const [usersResult, coursesResult, enrollmentsResult] = await Promise.all([
          supabase.from('profiles').select('id', { count: 'exact', head: true }),
          supabase.from('courses').select('id', { count: 'exact', head: true }).eq('is_published', true),
          supabase.from('enrollments').select('id', { count: 'exact', head: true }),
        ]);

        return await sendResponse(jsonResponse({
          stats: {
            total_users: usersResult.count || 0,
            published_courses: coursesResult.count || 0,
            total_enrollments: enrollmentsResult.count || 0,
          },
        }));
      }

      default:
        console.warn(`[API] Unknown action: ${action}`);
        return await sendResponse(errorResponse(`Unknown action: ${action}`, 'INVALID_ACTION', 400), `Unknown action: ${action}`);
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[API] Error in ${action}:`, errorMessage);

    await logRequest(supabase, apiKeyHash, action, 500, responseTime, errorMessage, requestData, ipAddress, userAgent);

    return new Response(
      JSON.stringify({ error: errorMessage, code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
