-- Switch user identity from email to phone for login.
ALTER TABLE "User" ADD COLUMN "phone" TEXT;

-- Backfill deterministic distinct phones for existing users, preserving all rows.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rn
  FROM "User"
)
UPDATE "User" u
SET "phone" = '010' || LPAD(ranked.rn::text, 8, '0')
FROM ranked
WHERE u."id" = ranked."id" AND (u."phone" IS NULL OR BTRIM(u."phone") = '');

ALTER TABLE "User" ALTER COLUMN "phone" SET NOT NULL;
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
ALTER TABLE "User" DROP COLUMN "email";

-- Error reports now store user phone snapshot.
ALTER TABLE "ErrorReport" ADD COLUMN "userPhone" TEXT;
ALTER TABLE "ErrorReport" DROP COLUMN "userEmail";
