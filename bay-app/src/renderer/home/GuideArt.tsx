/**
 * Flat illustrations for the 4-step startup guide (SetupHelp). Drawn as SVG so
 * they stay crisp on the 4K bay screens and match the kiosk theme.
 * All share a 400×240 canvas.
 */

const SKIN = '#f3c9a6';
const SKIN_DARK = '#d9a57e';
const WALL = '#1b2742';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg className="guide-art" viewBox="0 0 400 240" role="img" aria-hidden>
      <rect width="400" height="240" rx="16" fill={WALL} />
      {children}
    </svg>
  );
}

/** A pointing hand: index finger extended toward (x, y), coming from the bottom-right. */
function PointingHand({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) rotate(-28)`}>
      {/* fist */}
      <rect x="-26" y="30" width="62" height="62" rx="22" fill={SKIN} />
      {/* curled fingers */}
      <rect x="2" y="26" width="18" height="30" rx="9" fill={SKIN_DARK} opacity="0.55" />
      <rect x="20" y="30" width="16" height="30" rx="8" fill={SKIN_DARK} opacity="0.55" />
      {/* index finger, tip at origin */}
      <rect x="-13" y="-4" width="26" height="70" rx="13" fill={SKIN} />
      <rect x="-13" y="34" width="26" height="4" fill={SKIN_DARK} opacity="0.35" />
      {/* thumb */}
      <rect x="-40" y="40" width="22" height="40" rx="11" fill={SKIN} transform="rotate(35 -29 60)" />
    </g>
  );
}

/** Step 1 — wall-mounted timer switch, finger pressing 60 Min, monitor beside it. */
export function TimerArt() {
  const bx = 150;
  const by = 32;
  const bw = 100;
  const bh = 176;
  const rows: [string, string][] = [
    ['ON', 'OFF'],
    ['5 Min', '15 Min'],
    ['30 Min', '60 Min'],
    ['2H', '4H'],
  ];
  const rowH = (bh - 16) / 4;
  return (
    <Frame>
      {/* monitor on the right */}
      <rect x="290" y="46" width="130" height="86" rx="6" fill="#0b1220" stroke="#2b3a5c" strokeWidth="3" />
      <rect x="297" y="53" width="116" height="72" rx="3" fill="#13213b" />
      <rect x="345" y="134" width="20" height="26" fill="#2b3a5c" />
      <rect x="322" y="158" width="66" height="7" rx="3" fill="#2b3a5c" />
      {/* switch body */}
      <rect x={bx + 4} y={by + 6} width={bw} height={bh} rx="14" fill="rgba(0,0,0,0.35)" />
      <rect x={bx} y={by} width={bw} height={bh} rx="14" fill="#f8fafc" />
      {rows.map(([l, r], i) => {
        const y = by + 8 + i * rowH;
        const cells = [l, r];
        return cells.map((label, j) => {
          const x = bx + 8 + j * (bw - 16) / 2;
          const w = (bw - 16) / 2 - 3;
          const pressed = label === '60 Min';
          return (
            <g key={label}>
              <rect x={x} y={y + 2} width={w} height={rowH - 6} rx="7" fill={pressed ? 'var(--green)' : '#e2e8f0'} stroke={pressed ? '#15803d' : '#cbd5e1'} strokeWidth="1.5" />
              <text x={x + w / 2} y={y + rowH / 2 + 3} textAnchor="middle" fontSize={label.length > 3 ? 11 : 12} fontWeight={700} fill={pressed ? '#052e16' : '#334155'} style={{ fontFamily: 'var(--font)' }}>
                {label}
              </text>
            </g>
          );
        });
      })}
      {/* press ripple on 60 Min; fingertip rests on the button's lower-right corner so the label stays readable */}
      <circle cx={bx + 8 + (bw - 16) * 0.75} cy={by + 8 + 2.5 * rowH} r="30" fill="none" stroke="var(--green)" strokeWidth="2" opacity="0.45" />
      <circle cx={bx + 8 + (bw - 16) * 0.75} cy={by + 8 + 2.5 * rowH} r="42" fill="none" stroke="var(--green)" strokeWidth="2" opacity="0.2" />
      <PointingHand x={bx + bw - 10} y={by + 8 + 3 * rowH - 6} scale={0.85} />
    </Frame>
  );
}

/** Step 2 — ceiling projector at the front of the bay, remote with a green ON button pointed at it. */
export function ProjectorArt() {
  return (
    <Frame>
      {/* ceiling */}
      <rect x="0" y="0" width="400" height="18" fill="#243354" />
      <rect x="236" y="18" width="10" height="26" fill="#2b3a5c" />
      {/* projector */}
      <rect x="196" y="44" width="92" height="40" rx="8" fill="#e2e8f0" />
      <rect x="196" y="44" width="92" height="40" rx="8" fill="none" stroke="#94a3b8" strokeWidth="2" />
      <circle cx="206" cy="64" r="11" fill="#0f172a" stroke="#64748b" strokeWidth="2" />
      <circle cx="206" cy="64" r="5" fill="#38bdf8" opacity="0.9" />
      <rect x="226" y="52" width="40" height="5" rx="2" fill="#94a3b8" />
      <rect x="226" y="62" width="30" height="5" rx="2" fill="#94a3b8" />
      <circle cx="279" cy="72" r="3" fill="var(--green)" />
      {/* light cone to the left (screen) */}
      <polygon points="196,60 20,22 20,170 196,70" fill="#38bdf8" opacity="0.1" />
      <polygon points="196,60 20,22 20,170 196,70" fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.35" />
      {/* hand with remote, bottom right */}
      <g transform="translate(300 150) rotate(-40)">
        <rect x="-18" y="-10" width="36" height="110" rx="10" fill="#1e293b" stroke="#475569" strokeWidth="2" />
        <circle cx="0" cy="12" r="10" fill="var(--green)" />
        <text x="0" y="16" textAnchor="middle" fontSize="9" fontWeight={800} fill="#052e16" style={{ fontFamily: 'var(--font)' }}>ON</text>
        <rect x="-11" y="34" width="22" height="7" rx="3" fill="#475569" />
        <rect x="-11" y="48" width="22" height="7" rx="3" fill="#475569" />
        <rect x="-11" y="62" width="9" height="7" rx="3" fill="#475569" />
        <rect x="2" y="62" width="9" height="7" rx="3" fill="#475569" />
        {/* hand wrapping the remote */}
        <rect x="-30" y="60" width="60" height="60" rx="22" fill={SKIN} />
        <rect x="-26" y="52" width="14" height="30" rx="7" fill={SKIN_DARK} opacity="0.5" />
        {/* thumb on ON */}
        <rect x="8" y="2" width="20" height="40" rx="10" fill={SKIN} transform="rotate(20 18 22)" />
      </g>
      {/* IR signal arcs from remote tip toward the projector */}
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M ${262 - i * 14} ${124 - i * 14} q 10 -22 32 -26`} fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" opacity={0.75 - i * 0.22} />
      ))}
    </Frame>
  );
}

/** Step 3 — this kiosk's home screen with a finger on Play. */
export function PlayArt() {
  return (
    <Frame>
      {/* screen */}
      <rect x="40" y="26" width="320" height="180" rx="12" fill="#0b1220" stroke="#2b3a5c" strokeWidth="3" />
      {/* header */}
      <circle cx="66" cy="50" r="9" fill="var(--green)" />
      <rect x="82" y="44" width="70" height="7" rx="3" fill="#cbd5e1" />
      <rect x="82" y="55" width="40" height="5" rx="2" fill="#64748b" />
      <rect x="300" y="44" width="44" height="12" rx="6" fill="#1d2a47" />
      {/* Play tile */}
      <rect x="62" y="82" width="130" height="100" rx="12" fill="var(--green)" />
      <rect x="74" y="94" width="26" height="26" rx="7" fill="rgba(255,255,255,0.25)" />
      <polygon points="83,101 83,113 94,107" fill="#fff" />
      <text x="74" y="156" fontSize="20" fontWeight={800} fill="#fff" style={{ fontFamily: 'var(--font)' }}>Play</text>
      <rect x="74" y="164" width="96" height="5" rx="2" fill="rgba(255,255,255,0.6)" />
      {/* Setup Help tile */}
      <rect x="206" y="82" width="130" height="100" rx="12" fill="#1d2a47" />
      <rect x="218" y="94" width="26" height="26" rx="7" fill="rgba(255,255,255,0.08)" />
      <rect x="218" y="146" width="80" height="9" rx="3" fill="#cbd5e1" />
      <rect x="218" y="164" width="100" height="5" rx="2" fill="#64748b" />
      {/* tap ripple + hand, kept off the "Play" label */}
      <circle cx="160" cy="118" r="20" fill="none" stroke="#fff" strokeWidth="2" opacity="0.5" />
      <PointingHand x={164} y={122} scale={0.9} />
    </Frame>
  );
}

/** Step 4 — GSPro's main menu tiles with what each one is for. */
export function ModesArt() {
  const tiles: { label: string; sub: string; fill: string; dim?: boolean }[] = [
    { label: 'PRACTICE', sub: 'Range', fill: '#2f7a4a' },
    { label: 'LOCAL MATCH', sub: 'Rounds', fill: '#2e6b8f' },
    { label: 'CHALLENGES', sub: 'Contests', fill: '#8a5a2b' },
    { label: 'TOURNAMENTS', sub: 'Own account', fill: '#3a4357', dim: true },
    { label: 'ONLINE MATCH', sub: 'Links bays', fill: '#3a4357', dim: true },
  ];
  const w = 70;
  const gap = 6;
  const x0 = (400 - (tiles.length * w + (tiles.length - 1) * gap)) / 2;
  return (
    <Frame>
      {/* GSPro top bar */}
      <rect x="0" y="0" width="400" height="30" fill="#0a1a24" />
      <text x="200" y="20" textAnchor="middle" fontSize="14" fontWeight={900} fill="#e2e8f0" letterSpacing="2" style={{ fontFamily: 'var(--font)' }}>GSPRO</text>
      <text x="26" y="66" fontSize="26" fontWeight={800} fill="#f1f5f9" style={{ fontFamily: 'var(--font)' }}>WELCOME</text>
      <rect x="26" y="74" width="150" height="5" rx="2" fill="#64748b" />
      {tiles.map((t, i) => {
        const x = x0 + i * (w + gap);
        return (
          <g key={t.label} opacity={t.dim ? 0.6 : 1}>
            <rect x={x} y="104" width={w} height="78" rx="8" fill={t.fill} stroke={t.dim ? '#475569' : '#e2e8f0'} strokeWidth="2" />
            <rect x={x + 6} y="110" width={w - 12} height="36" rx="4" fill="rgba(255,255,255,0.12)" />
            <text x={x + w / 2} y="168" textAnchor="middle" fontSize={t.label.length > 10 ? 7.5 : 8.5} fontWeight={800} fill="#fff" style={{ fontFamily: 'var(--font)' }}>
              {t.label}
            </text>
            <text x={x + w / 2} y="206" textAnchor="middle" fontSize="12" fontWeight={700} fill={t.dim ? 'var(--text-3)' : 'var(--green)'} style={{ fontFamily: 'var(--font)' }}>
              {t.sub}
            </text>
          </g>
        );
      })}
    </Frame>
  );
}

/** Callout: top-down hitting mat, wider than tall like the real one. The screen
 *  is "up" (arrow at the top); the front third nearest the screen is dimmed and
 *  the back two-thirds is the hitting zone. Crossed-out balls sit beside the mat.
 *  400×200 canvas. */
export function MatArt() {
  const mx = 110, my = 42, mw = 180, mh = 128;
  const frontH = mh / 3;
  const zoneTop = my + 6 + frontH;
  const zoneH = mh - 12 - frontH;
  const label = (x: number, y: number, size: number, text: string, fill = 'var(--text-2)', weight = 400) => (
    <text x={x} y={y} textAnchor="middle" fontSize={size} fontWeight={weight} fill={fill} style={{ fontFamily: 'var(--font)' }}>{text}</text>
  );
  return (
    <svg className="guide-art-sm" viewBox="0 0 400 200" role="img" aria-hidden>
      <rect width="400" height="200" rx="16" fill={WALL} />
      {/* screen direction: up */}
      <path d="M200 34 L200 12" stroke="var(--text-2)" strokeWidth="3" strokeLinecap="round" />
      <path d="M190 22 L200 10 L210 22" fill="none" stroke="var(--text-2)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {label(230, 26, 11, 'screen')}
      {/* mat */}
      <rect x={mx} y={my} width={mw} height={mh} rx="10" fill="#2f6b3a" />
      <rect x={mx + 6} y={my + 6} width={mw - 12} height={mh - 12} rx="7" fill="#3f8a4c" />
      {/* front third (toward the screen), dimmed */}
      <rect x={mx + 6} y={my + 6} width={mw - 12} height={frontH} rx="7" fill="#1b2742" opacity="0.45" />
      {/* back 2/3 highlight */}
      <rect x={mx + 6} y={zoneTop} width={mw - 12} height={zoneH} rx="7" fill="none" stroke="var(--green)" strokeWidth="4" strokeDasharray="10 7" />
      {label(mx + mw / 2, zoneTop + zoneH / 2 - 2, 15, 'HIT FROM HERE', '#fff', 800)}
      {label(mx + mw / 2, zoneTop + zoneH / 2 + 16, 11, 'back 2/3 of the mat', '#d1fae5')}
      {/* ball teed up in the hitting zone */}
      <circle cx={mx + mw / 2} cy={my + mh - 18} r="6" fill="#fff" />
      {/* stray balls / white objects beside the mat, crossed out */}
      {[[326, 80], [344, 128], [322, 160]].map(([cx, cy]) => (
        <g key={cx}>
          <circle cx={cx} cy={cy} r="8" fill="#fff" />
          <circle cx={cx} cy={cy} r="14" fill="none" stroke="#f87171" strokeWidth="3" />
          <path d={`M${cx - 10} ${cy - 10} L${cx + 10} ${cy + 10}`} stroke="#f87171" strokeWidth="3" strokeLinecap="round" />
        </g>
      ))}
      {/* caption, left of the mat */}
      {label(55, 90, 12, 'No balls or')}
      {label(55, 106, 12, 'white objects')}
      {label(55, 122, 12, 'on or around')}
      {label(55, 138, 12, 'the mat')}
    </svg>
  );
}
