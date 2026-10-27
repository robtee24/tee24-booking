import type { UpdatePhase } from '../shared/types';
import { Logo } from '../shared/Logo';

type Phase = UpdatePhase | { phase: 'done'; version: string } | { phase: 'boot' };

export function Splash({ phase }: { phase: Phase }) {
  let title = 'Starting up…';
  let sub = 'Checking for updates';
  let percent: number | null = null;

  switch (phase.phase) {
    case 'checking':
      sub = 'Checking for updates…';
      break;
    case 'downloading':
      title = 'Updating…';
      sub = phase.version ? `Downloading version ${phase.version}` : 'Downloading the latest version';
      percent = phase.percent;
      break;
    case 'installing':
      title = 'Installing update';
      sub = 'The kiosk will restart in a moment.';
      percent = 100;
      break;
    case 'error':
      title = 'Starting up…';
      sub = 'Update check skipped (offline). Continuing.';
      break;
    default:
      break;
  }

  return (
    <div className="splash">
      <div>
        <Logo height={140} className="splash-logo" />
        <h1>{title}</h1>
        <p>{sub}</p>
        <div className={`progress ${percent === null ? 'indeterminate' : ''}`}>
          <div style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
}
