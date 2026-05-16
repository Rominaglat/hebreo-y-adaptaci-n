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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
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
    
    // Create client with anon key and verify the token
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
    
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role for data access
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { examId, answers } = await req.json();

    if (!examId || !answers) {
      return new Response(
        JSON.stringify({ error: 'Missing examId or answers' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Submitting exam ${examId} for user ${user.id}`);

    // Fetch exam
    const { data: exam, error: examError } = await supabase
      .from('exams')
      .select('*')
      .eq('id', examId)
      .single();

    if (examError || !exam) {
      console.error('Exam not found:', examError);
      return new Response(
        JSON.stringify({ error: 'Exam not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch questions with correct answers (server-side only)
    const { data: questions, error: questionsError } = await supabase
      .from('exam_questions')
      .select('*')
      .eq('exam_id', examId);

    if (questionsError) {
      console.error('Error fetching questions:', questionsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch questions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate score on the server (secure - user can't manipulate)
    let totalPoints = 0;
    let earnedPoints = 0;

    const questionsWithResults = questions?.map(question => {
      totalPoints += question.points;
      const userAnswer = answers[question.id] || [];
      const correctOptions = (question.correct_options as number[]) || [];
      
      const isCorrect = 
        userAnswer.length === correctOptions.length &&
        userAnswer.every((a: number) => correctOptions.includes(a));
      
      if (isCorrect) {
        earnedPoints += question.points;
      }

      return {
        ...question,
        userAnswer,
        isCorrect
      };
    }) || [];

    const scorePercentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    const hasPassed = scorePercentage >= exam.passing_score;

    console.log(`Score: ${scorePercentage}%, Passed: ${hasPassed}`);

    // Save the attempt
    const { data: attempt, error: attemptError } = await supabase
      .from('exam_attempts')
      .insert({
        exam_id: examId,
        user_id: user.id,
        answers: answers,
        score: scorePercentage,
        passed: hasPassed,
        completed_at: new Date().toISOString()
      })
      .select()
      .single();

    if (attemptError) {
      console.error('Error saving attempt:', attemptError);
      return new Response(
        JSON.stringify({ error: 'Failed to save attempt' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return results with correct answers (now that exam is completed)
    return new Response(
      JSON.stringify({ 
        success: true,
        attemptId: attempt.id,
        score: scorePercentage,
        passed: hasPassed,
        passingScore: exam.passing_score,
        questions: questionsWithResults.map(q => ({
          id: q.id,
          question_text: q.question_text,
          options: q.options,
          correct_options: q.correct_options,
          explanation: q.explanation,
          userAnswer: q.userAnswer,
          isCorrect: q.isCorrect,
          points: q.points
        }))
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
