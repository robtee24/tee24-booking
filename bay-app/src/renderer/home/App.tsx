import { useEffect, useState } from 'react';
import { kiosk, useKioskState } from '../shared/bridge';
import type { UpdatePhase } from '../shared/types';
import { Splash } from './Splash';
import { Home } from './Home';
import { Setup } from './Setup';
import { Settings } from './Settings';
import { SetupHelp } from './SetupHelp';

type Screen = 'home' | 'setup-help' | 'settings';
type Phase = UpdatePhase | { phase: 'done'; version: string } | { phase: 'boot' };

export function App() {
  const state = useKioskState();
  const [update, setUpdate] = useState<Phase>({ phase: 'boot' });
  const [screen, setScreen] = useState<Screen>('home');

  useEffect(() => kiosk.onUpdate((p) => setUpdate(p as Phase)), []);

  // Main sends 'done' once the startup update check resolves. In dev (not packaged)
  // it resolves immediately; if the renderer loaded late we may have missed it, so
  // treat a populated state as "booted" after a short grace period.
  const [grace, setGrace] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrace(true), 2500);
    return () => clearTimeout(t);
  }, []);
  // Once booted, stay booted: later background checks ('checking', 'none') must
  // not bring the splash back. A download/install does take over the screen.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    if (update.phase === 'done' || update.phase === 'none' || update.phase === 'error' || (grace && update.phase === 'boot')) setBooted(true);
  }, [update, grace]);
  const updating = update.phase === 'downloading' || update.phase === 'installing';

  if (!state || !booted || updating) return <Splash phase={update} />;

  if (!state.registered) {
    return <Setup onDone={() => setScreen('home')} />;
  }

  if (screen === 'settings') return <Settings state={state} onClose={() => setScreen('home')} />;
  if (screen === 'setup-help') return <SetupHelp state={state} onClose={() => setScreen('home')} />;
  return <Home state={state} onSetupHelp={() => setScreen('setup-help')} onSettings={() => setScreen('settings')} />;
}
