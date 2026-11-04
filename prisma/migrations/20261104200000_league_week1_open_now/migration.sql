-- Start the season now: Week 1 (Pebble Beach) opens Wed Nov 4, 2026 instead
-- of Mon Nov 9. Deadline unchanged (Sun Nov 15, 23:59:59 local).
UPDATE "LeagueWeek" w
SET "opensAt" = (TIMESTAMP '2026-11-04 00:00:00' AT TIME ZONE l."timezone") AT TIME ZONE 'UTC',
    "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT lg."id", loc."timezone"
  FROM "League" lg JOIN "Location" loc ON loc."id" = lg."locationId"
  WHERE lg."id" = 'league_season_2026'
) l
WHERE w."leagueId" = l."id"
  AND w."weekNumber" = 1
  AND w."finalizedAt" IS NULL
  AND w."opensAt" > CURRENT_TIMESTAMP;
