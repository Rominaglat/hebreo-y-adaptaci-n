import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Get the authorization header to identify the user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract the JWT token
    const token = authHeader.replace('Bearer ', '');
    
    // Create admin client for database operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Create a client with the user's token to verify their identity
    const supabaseClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: {
        headers: { Authorization: authHeader }
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    // Verify the JWT and get user
    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    
    if (userError || !userData?.user) {
      console.error('Auth error:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: userError?.message || 'Auth session missing!' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const user = userData.user;
    const { examId, includeAnswers } = await req.json();

    if (!examId) {
      return new Response(
        JSON.stringify({ error: 'Missing examId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Fetching questions for exam ${examId}, user ${user.id}, includeAnswers: ${includeAnswers}`);

    // Check if user is admin or instructor
    const { data: roleData } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    const isAdminOrInstructor = roleData?.role === 'admin' || roleData?.role === 'instructor';

    // Check if user has completed this exam
    const { data: completedAttempt } = await supabaseAdmin
      .from('exam_attempts')
      .select('id')
      .eq('exam_id', examId)
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .limit(1)
      .maybeSingle();

    const hasCompletedExam = !!completedAttempt;

    // Fetch questions
    const { data: questions, error: questionsError } = await supabaseAdmin
      .from('exam_questions')
      .select('*')
      .eq('exam_id', examId)
      .order('order_index');

    if (questionsError) {
      console.error('Error fetching questions:', questionsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch questions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process questions - hide answers if needed
    const shouldShowAnswers = includeAnswers && (isAdminOrInstructor || hasCompletedExam);
    
    const processedQuestions = questions?.map(q => ({
      id: q.id,
      exam_id: q.exam_id,
      question_text: q.question_text,
      question_type: q.question_type,
      options: q.options,
      points: q.points,
      image_url: q.image_url,
      order_index: q.order_index,
      // Only include correct_options and explanation if authorized
      correct_options: shouldShowAnswers ? q.correct_options : [],
      explanation: shouldShowAnswers ? q.explanation : null
    })) || [];

    console.log(`Returning ${processedQuestions.length} questions, answers included: ${shouldShowAnswers}`);

    return new Response(
      JSON.stringify({ 
        questions: processedQuestions,
        canSeeAnswers: shouldShowAnswers,
        isAdminOrInstructor,
        hasCompletedExam
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
