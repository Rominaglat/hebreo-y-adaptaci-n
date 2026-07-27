-- Reordering courses must re-derive the cross-course prerequisite chain.
--
-- Background
-- ----------
-- 20260603120000 moved cross-course gating off the implicit
-- (course.order_index, module.order_index, lesson.order_index) lexicographic
-- rule and onto an explicit courses.prerequisite_course_id pointer. The admin
-- Courses page drag-and-drop was never updated: it still writes only
-- order_index, one UPDATE per course, in a loop. So after any reorder the
-- gating chain kept pointing at whatever course *used* to precede each one,
-- and the visible catalog order had no effect on what is locked.
--
-- Observed in production 2026-07-27: "Hebreo conversacional" (order_index 4)
-- still required "Proyección y matices (futuro)", which had been dragged to
-- order_index 8 *and* unpublished. Students never see unpublished courses, so
-- its 8 lessons could never be completed — an unsatisfiable gate. Every
-- enrolled student (e.g. Sandra Roffé, who had finished courses 0-3) was
-- permanently locked out of a course they had paid for.
--
-- New rule: the catalog order IS the chain
-- ----------------------------------------
--   * "Chainable" course = is_optional = false AND is_published = true.
--   * Each chainable course's prerequisite is the previous chainable course
--     in order_index order. The first one gets NULL.
--   * Optional and unpublished courses get NULL: they neither gate nor are
--     gated. Unpublished is the important half — an invisible course can
--     never be completed, so it must never gate a visible one.
--
-- The chain is therefore derived state. Anything that changes an input
-- (order_index, is_published, is_optional) has to re-derive it, so both
-- admin entry points below do exactly that. Note this makes the manual
-- prerequisite dropdown in the course editor advisory: the next reorder or
-- publish toggle re-derives the whole chain from the order.

-- ─── Internal: re-derive the whole chain from current order/flags ────
-- Not granted to anyone — reachable only through the admin-gated wrappers
-- below, because SECURITY DEFINER here bypasses RLS on courses.
CREATE OR REPLACE FUNCTION public.rebuild_course_prerequisite_chain()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed integer;
BEGIN
  WITH chainable AS (
    SELECT c.id,
           LAG(c.id) OVER (
             ORDER BY c.order_index NULLS LAST, c.created_at, c.id
           ) AS prev_id
    FROM public.courses c
    WHERE c.is_optional = false
      AND c.is_published = true
  ),
  -- Every course, with the prerequisite it *should* have. A course missing
  -- from `chainable` (optional or unpublished) misses the LEFT JOIN and so
  -- resolves to NULL, which is exactly the intent.
  target AS (
    SELECT c.id, ch.prev_id AS want_prereq
    FROM public.courses c
    LEFT JOIN chainable ch ON ch.id = c.id
  ),
  upd AS (
    UPDATE public.courses c
    SET prerequisite_course_id = t.want_prereq,
        updated_at             = now()
    FROM target t
    WHERE c.id = t.id
      AND c.prerequisite_course_id IS DISTINCT FROM t.want_prereq
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_changed FROM upd;

  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_course_prerequisite_chain() FROM PUBLIC;

COMMENT ON FUNCTION public.rebuild_course_prerequisite_chain() IS
  'Re-derives courses.prerequisite_course_id from order_index across published, non-optional courses. Returns the number of rows re-pointed. Internal — call via admin_reorder_courses / admin_rebuild_course_prerequisites.';

-- ─── Admin: persist a new catalog order and re-derive the chain ──────
-- One atomic call replacing the client-side per-course UPDATE loop, so a
-- half-applied order can no longer leave the catalog inconsistent.
CREATE OR REPLACE FUNCTION public.admin_reorder_courses(p_course_ids uuid[])
RETURNS TABLE(course_id uuid, order_position integer, prerequisite_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'admin_reorder_courses: not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_course_ids IS NULL OR array_length(p_course_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'admin_reorder_courses: p_course_ids must be a non-empty array'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_course_ids) AS t(id)
    GROUP BY t.id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'admin_reorder_courses: duplicate course id in p_course_ids'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_course_ids) AS t(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.courses c WHERE c.id = t.id)
  ) THEN
    RAISE EXCEPTION 'admin_reorder_courses: unknown course id in p_course_ids'
      USING ERRCODE = '23503';
  END IF;

  -- Positions come from the caller's array. Any course the caller didn't
  -- send — e.g. one created after their page loaded — keeps its relative
  -- order and lands after the listed ones instead of being clobbered to 0.
  WITH listed AS (
    SELECT t.id, (t.ord - 1)::integer AS pos
    FROM unnest(p_course_ids) WITH ORDINALITY AS t(id, ord)
  ),
  rest AS (
    SELECT c.id,
           ((SELECT count(*) FROM listed)
             + row_number() OVER (
                 ORDER BY c.order_index NULLS LAST, c.created_at, c.id
               ) - 1)::integer AS pos
    FROM public.courses c
    WHERE NOT EXISTS (SELECT 1 FROM listed l WHERE l.id = c.id)
  ),
  final AS (
    SELECT id, pos FROM listed
    UNION ALL
    SELECT id, pos FROM rest
  )
  UPDATE public.courses c
  SET order_index = f.pos,
      updated_at  = now()
  FROM final f
  WHERE c.id = f.id
    AND c.order_index IS DISTINCT FROM f.pos;

  PERFORM public.rebuild_course_prerequisite_chain();

  RETURN QUERY
    SELECT c.id, c.order_index, c.prerequisite_course_id
    FROM public.courses c
    ORDER BY c.order_index NULLS LAST, c.created_at, c.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reorder_courses(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.admin_reorder_courses(uuid[]) IS
  'Admin-only. Writes order_index from the given course-id order, then re-derives the prerequisite chain, atomically. Returns the resulting catalog order.';

-- ─── Admin: re-derive the chain without reordering ───────────────────
-- Used after a publish/unpublish toggle, which changes which courses are
-- chainable and so has the same power to strand students behind an
-- unsatisfiable gate.
CREATE OR REPLACE FUNCTION public.admin_rebuild_course_prerequisites()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'admin_rebuild_course_prerequisites: not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.rebuild_course_prerequisite_chain();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_rebuild_course_prerequisites() TO authenticated;

COMMENT ON FUNCTION public.admin_rebuild_course_prerequisites() IS
  'Admin-only. Re-derives courses.prerequisite_course_id from the current catalog order. Returns the number of courses re-pointed.';

-- ─── One-shot repair of the state this bug already left behind ───────
DO $$
DECLARE
  v_changed integer;
BEGIN
  v_changed := public.rebuild_course_prerequisite_chain();
  RAISE NOTICE 'rebuild_course_prerequisite_chain: % course(s) re-pointed', v_changed;
END $$;
