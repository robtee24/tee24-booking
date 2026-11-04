-- Season one of the Tee24 League: 16 weeks, Monday 00:00 → Sunday 23:59:59
-- local. Week 1 is Pebble Beach (due Sun Nov 15, 2026); later weeks are
-- "Course TBA" until staff set the course in Admin → League. Does nothing if a
-- league is already running or the Clarksville location doesn't exist.
DO $$
DECLARE
  loc RECORD;
  lid TEXT := 'league_season_2026';
  first_monday DATE := DATE '2026-11-09';
  i INT;
BEGIN
  IF EXISTS (SELECT 1 FROM "League" WHERE "status" IN ('OPEN', 'ACTIVE')) THEN
    RETURN;
  END IF;
  SELECT "id", "organizationId", "timezone" INTO loc FROM "Location" WHERE "slug" = 'clarksville';
  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO "League" ("id", "organizationId", "locationId", "name", "status", "championshipAt", "teeRules", "updatedAt")
  VALUES (
    lid,
    loc."organizationId",
    loc."id",
    'Tee24 Winter League',
    'OPEN',
    (TIMESTAMP '2027-03-06 12:00:00' AT TIME ZONE loc."timezone") AT TIME ZONE 'UTC',
    '[{"label":"Under 50","maxAge":49,"tee":"Blue"},{"label":"50–64","maxAge":64,"tee":"White"},{"label":"65 and over","maxAge":null,"tee":"Gold"}]'::jsonb,
    CURRENT_TIMESTAMP
  );

  FOR i IN 1..16 LOOP
    INSERT INTO "LeagueWeek" ("id", "leagueId", "weekNumber", "courseName", "opensAt", "deadlineAt", "updatedAt")
    VALUES (
      lid || '_w' || i,
      lid,
      i,
      CASE WHEN i = 1 THEN 'Pebble Beach' ELSE 'Course TBA' END,
      ((first_monday + (i - 1) * 7)::timestamp AT TIME ZONE loc."timezone") AT TIME ZONE 'UTC',
      (((first_monday + (i - 1) * 7 + 6)::timestamp + TIME '23:59:59') AT TIME ZONE loc."timezone") AT TIME ZONE 'UTC',
      CURRENT_TIMESTAMP
    );
  END LOOP;
END $$;
