/**
 * League rules + settings copy. Shared by the public web rules page; the app
 * and kiosk render the same facts from the hub payload.
 */
import { Card, L, SectionTitle, money } from "./ui";

export type RulesSettings = {
  weeklyFeeCents: number;
  minorAge: number;
  openingWeeks: number;
  handicapCap: number;
  throwOutEvery: number;
  pointsTop5: number;
  pointsTop10: number;
  pointsTop15: number;
  pointsTeamWin: number;
  pointsTeamTie: number;
  firstPlacePct: number;
  firstPlaceCapCents: number;
  secondPlacePct: number;
  secondPlaceCapCents: number;
  championshipTopPct: number;
  gimmeDistanceFt: number;
  mulligans: boolean;
  greenSpeed: string;
  teeRules: unknown;
};

export function teeRulesList(raw: unknown): { label: string; tee: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r) => r && typeof r === "object").map((r) => ({ label: String((r as { label?: string }).label ?? ""), tee: String((r as { tee?: string }).tee ?? "") }));
}

export function GameSettings({ s }: { s: RulesSettings }) {
  const tees = teeRulesList(s.teeRules);
  return (
    <Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Setting label="Gimmes" value={`${s.gimmeDistanceFt}'`} note="Set gimme distance in GSPro" />
        <Setting label="Mulligans" value={s.mulligans ? "ON" : "OFF"} note="Card is rejected if mulligans show on" warn={!s.mulligans} />
        <Setting label="Green speed" value={s.greenSpeed} />
      </div>
      {tees.length ? (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: L.text3 }}>Tees (by age — honor system)</div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {tees.map((t) => (
              <span key={t.label} className="rounded-full px-3 py-1 text-xs" style={{ background: L.surface2, color: L.text2 }}>
                <span style={{ color: L.text }}>{t.label}</span> · {t.tee}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function Setting({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className="rounded-xl p-3" style={{ background: L.surface2 }}>
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: L.text3 }}>{label}</div>
      <div className="mt-0.5 text-lg font-semibold" style={{ color: warn ? L.amber : L.text }}>{value}</div>
      {note ? <div className="text-[11px]" style={{ color: L.text3 }}>{note}</div> : null}
    </div>
  );
}

export function RulesBody({ s, championshipAt, leagueName }: { s: RulesSettings; championshipAt: string | null; leagueName: string }) {
  const champ = championshipAt ? new Date(championshipAt).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : null;
  return (
    <div className="space-y-1">
      <SectionTitle>Joining</SectionTitle>
      <Card>
        <Ol>
          <li>Open to Tee24 members at every location — it&apos;s one league. Join any time during the season from the Tee24 app (Events → League → Join) or at the bay kiosk (League → Join). There&apos;s no sign-up fee; you only pay for the weeks you play.</li>
          <li>Keep a card on file in the Tee24 app (Settings → Membership → Payment method). It&apos;s what gets charged for each week&apos;s entry.</li>
          <li>Players under {s.minorAge} are flagged on the leaderboard, play every week free, earn points and can qualify for the championship, but can&apos;t win money.</li>
          <li>Join late and you simply start earning points from your first week; weeks you didn&apos;t play score nothing.</li>
        </Ol>
      </Card>

      <SectionTitle>How it works</SectionTitle>
      <Card>
        <Ol>
          <li>Play one 18-hole round each week at the week&apos;s course, any time before <b>Sunday 11:59 PM</b>. One score per player per week. There are no make-up rounds.</li>
          <li>Entry is <b>{money(s.weeklyFeeCents)} per week</b>, charged to your card on file the moment your score is submitted at the bay. No card, or a declined card, means the score isn&apos;t accepted — add a card in the Tee24 app (Settings → Membership → Payment method) and resubmit before the deadline. Players under {s.minorAge} play free — they earn points and appear on the leaderboard but aren&apos;t eligible for money.</li>
          <li>Scores are hidden (shown as “Submitted”) until the Sunday deadline, when the whole week is revealed at once.</li>
          <li>Every score counts in <b>three leagues</b> at the same time: Individual Straight, Individual Handicapped, and Team.</li>
        </Ol>
      </Card>

      <SectionTitle>Game settings</SectionTitle>
      <GameSettings s={s} />

      <SectionTitle>Points · one leaderboard</SectionTitle>
      <Card>
        <P>Rankings are by points, not score. Each week in <b>both</b> individual leagues:</P>
        <Grid>
          <Kv k="Top 5" v={`${s.pointsTop5} pts`} />
          <Kv k="Top 10" v={`${s.pointsTop10} pts`} />
          <Kv k="Top 15" v={`${s.pointsTop15} pts`} />
          <Kv k="Team win" v={`${s.pointsTeamWin} pts`} />
          <Kv k="Team tie" v={`${s.pointsTeamTie} pt each`} />
        </Grid>
        <P>Finish top 5 straight and top 10 handicapped, and your team wins: {s.pointsTop5 + s.pointsTop10 + s.pointsTeamWin} points that week. Everyone is on one leaderboard, ranked by total points; ties on points share the rank. Tap any player on the leaderboard to see every scorecard, stats, weekly teams and winnings.</P>
      </Card>

      <SectionTitle>Handicaps</SectionTitle>
      <Card>
        <Ol>
          <li>The first {s.openingWeeks} weeks are played straight. Once week {s.openingWeeks} closes, handicaps are calculated for everyone and the handicapped results for weeks 1–{s.openingWeeks} are filled in.</li>
          <li>Each week, the lowest gross score is the 0. Everyone else&apos;s “strokes back” from it is recorded, capped at {s.handicapCap}.</li>
          <li>Your handicap is the average of your strokes-back. For every {s.throwOutEvery} rounds you&apos;ve played, your highest is thrown out.</li>
          <li>Handicaps update every week: your week-N score uses the handicap calculated after week N-1 closed. New players play straight until they have a closed week.</li>
        </Ol>
      </Card>

      <SectionTitle>Teams · best-ball match play</SectionTitle>
      <Card>
        <Ol>
          <li>Teams of two change every week. After each Sunday deadline the following week&apos;s teams are drawn — strongest paired with weakest by handicap, avoiding repeat partners — and matched against the closest-strength team.</li>
          <li>Your team&apos;s best gross score on each hole counts. Win a hole, win a point; the team with more holes wins the match ({s.pointsTeamWin} pts; ties are {s.pointsTeamTie} pt each). If only one player on a team posts a score, their ball is the team ball; a team with no score forfeits.</li>
          <li>The team money each week goes to the winning team with the biggest margin of holes; if tied on margin, the lower combined best-ball total takes it.</li>
          <li>See this week&apos;s teams under <b>Weeks</b> and your history on your profile.</li>
        </Ol>
      </Card>

      <SectionTitle>Money</SectionTitle>
      <Card>
        <P>Every dollar collected is paid back out — nothing is kept.</P>
        <Grid>
          <Kv k="1st place" v={`${s.firstPlacePct}% of pot, up to ${money(s.firstPlaceCapCents)}`} sub="split equally across the 4 weekly winners: straight 1st, handicapped 1st, and both players on the winning team" />
          <Kv k="2nd place" v={`${s.secondPlacePct}% of pot, up to ${money(s.secondPlaceCapCents)}`} sub="split the same way across the 2nd-place finishers" />
          <Kv k="Remainder" v="Championship pot" sub="whatever is left each week rolls into the League Championship" />
        </Grid>
        <P>Ties share a slot. Shares that would go to a player who isn&apos;t money-eligible (under {s.minorAge}) roll into the championship pot. Winnings are tracked on your profile and paid at the front desk.</P>
      </Card>

      <SectionTitle>League Championship</SectionTitle>
      <Card tone="green">
        <P>The top {s.championshipTopPct}% of the leaderboard by points qualify for the League Championship{champ ? ` on ${champ}` : ""}. 100% of the championship pot is paid out.</P>
      </Card>

      <SectionTitle>Submitting from the bay</SectionTitle>
      <Card>
        <P>Scores are submitted <b>only at the bay kiosk</b>, straight from the GSPro scorecard. The app is for joining, your card on file, the leaderboard, teams and your profile.</P>
        <Ol>
          <li>Before you tee off, open <b>League Settings</b> in GSPro and set gimmes to {s.gimmeDistanceFt}&apos;, mulligans <b>OFF</b>, {s.greenSpeed.toLowerCase()} greens, and tees for your age group.</li>
          <li>Finish all 18 holes and bring up the scorecard screen.</li>
          <li>Tap <b>League</b> on the bay toolbar. Enter your phone number and your name <b>exactly as it appears on the GSPro scorecard</b> — that&apos;s how your line on the card is matched to you. Add up to 5 players from the same card; each is charged separately.</li>
          <li>Tap Submit and confirm. The kiosk takes a screenshot of the scorecard, reads the scores, checks the settings and charges each member {money(s.weeklyFeeCents)}.</li>
          <li>If mulligans are on, the card can&apos;t be read, or a card is declined, that score isn&apos;t accepted and nothing is charged. Fix it and resubmit before Sunday 11:59 PM.</li>
          <li>One score per player per week — the first accepted submission counts. Rounds played without the league settings don&apos;t count. The kiosk keeps the scorecard screenshot so staff can review any disputed card.</li>
        </Ol>
      </Card>
      <div className="pt-4 text-center text-xs" style={{ color: L.text3 }}>{leagueName}</div>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="my-2 text-sm leading-6" style={{ color: L.text2 }}>{children}</p>;
}
function Ol({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 marker:font-semibold marker:text-[#22C55E]" style={{ color: L.text2 }}>{children}</ol>;
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="my-3 grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>;
}
function Kv({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: L.surface2 }}>
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: L.text3 }}>{k}</div>
      <div className="mt-0.5 text-sm font-semibold" style={{ color: L.text }}>{v}</div>
      {sub ? <div className="mt-0.5 text-xs" style={{ color: L.text3 }}>{sub}</div> : null}
    </div>
  );
}
