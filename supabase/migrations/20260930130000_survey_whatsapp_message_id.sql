-- Lychee's make-send-template answers {"ok":true,"messageId":"…","waId":"wamid…"}
-- — camelCase, although its docs show message_id. Observed on the first real
-- send (2026-09-30). Accept both so the send log keeps Lychee's message id.

-- ── 2. Reconcile pg_net responses ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.survey_whatsapp_reconcile()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; body jsonb; n integer := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.attempts, s.updated_at,
           h.id AS resp_id, h.status_code, h.content, h.timed_out, h.error_msg
    FROM public.survey_whatsapp_sends s
    LEFT JOIN net._http_response h ON h.id = s.request_id
    WHERE s.status = 'sending'
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    IF r.resp_id IS NULL THEN
      -- pg_net keeps responses 6h; nothing after 30 min means it's lost.
      IF r.updated_at < now() - interval '30 minutes' THEN
        UPDATE public.survey_whatsapp_sends
           SET status = 'failed', reason = 'no response from Lychee', updated_at = now()
         WHERE id = r.id;
        n := n + 1;
      END IF;
      CONTINUE;
    END IF;

    body := public.try_jsonb(r.content);
    IF r.status_code BETWEEN 200 AND 299 AND coalesce(body ->> 'ok', 'true') <> 'false' THEN
      UPDATE public.survey_whatsapp_sends
         SET status = 'sent', http_status = r.status_code, message_id = coalesce(body ->> 'messageId', body ->> 'message_id'),
             reason = NULL, request_id = NULL, updated_at = now()
       WHERE id = r.id;
    ELSIF (r.timed_out OR r.status_code IS NULL OR r.status_code IN (429, 500, 502, 503, 504))
          AND r.attempts < 3 THEN
      -- Transient: back in the queue; the same Idempotency-Key guards against a double send.
      UPDATE public.survey_whatsapp_sends
         SET status = 'queued', http_status = r.status_code, request_id = NULL,
             reason = left('retry: ' || coalesce(body ->> 'error', r.error_msg, 'HTTP ' || r.status_code), 300),
             updated_at = now()
       WHERE id = r.id;
    ELSE
      UPDATE public.survey_whatsapp_sends
         SET status = 'failed', http_status = r.status_code, request_id = NULL,
             reason = left(coalesce(body ->> 'error', r.error_msg, 'HTTP ' || r.status_code), 300),
             updated_at = now()
       WHERE id = r.id;
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION public.survey_whatsapp_reconcile() FROM PUBLIC, anon, authenticated;
