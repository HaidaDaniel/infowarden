ALTER TABLE "KnowledgeBase" ADD COLUMN "slug" TEXT;

WITH ranked AS (
  SELECT
    kb.id,
    COALESCE(
      NULLIF(
        trim(BOTH '-' FROM regexp_replace(lower(kb.name), '[^a-z0-9]+', '-', 'g')),
        ''
      ),
      'knowledge-base'
    ) AS base_slug,
    row_number() OVER (
      PARTITION BY COALESCE(
        NULLIF(
          trim(BOTH '-' FROM regexp_replace(lower(kb.name), '[^a-z0-9]+', '-', 'g')),
          ''
        ),
        'knowledge-base'
      )
      ORDER BY kb."createdAt", kb.id
    ) AS slug_rank
  FROM "KnowledgeBase" kb
)
UPDATE "KnowledgeBase" kb
SET "slug" = CASE
  WHEN ranked.slug_rank = 1 THEN ranked.base_slug
  ELSE ranked.base_slug || '-' || ranked.slug_rank
END
FROM ranked
WHERE kb.id = ranked.id;

ALTER TABLE "KnowledgeBase" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "KnowledgeBase_slug_key" ON "KnowledgeBase"("slug");
