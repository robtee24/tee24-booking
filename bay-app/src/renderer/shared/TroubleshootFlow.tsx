import { useEffect, useMemo, useState } from 'react';
import { kiosk, isErr } from './bridge';
import type { HelpResponse, TroubleshootStep } from './types';
import { BackIcon, ChevronIcon } from './Icons';

/**
 * Decision-tree walker over the shared troubleshooting guide, served by
 * /api/bay-app/help so edits ship without reinstalling the kiosk. Opens on the
 * right launch-monitor menu for this bay.
 */
export function TroubleshootFlow({ startAt }: { startAt?: 'entry' | 'common' | 'root' }) {
  const [help, setHelp] = useState<HelpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [steps, setSteps] = useState<TroubleshootStep[] | null>(null);
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    kiosk.getHelp().then((r) => {
      if (isErr(r)) return setError(r.error);
      const h = r as HelpResponse;
      setHelp(h);
      const start = startAt === 'root' ? 'start' : startAt === 'common' ? h.commonNodeId : h.entryNodeId;
      setPath([h.tree[start] ? start : 'start']);
    });
  }, [startAt]);

  const nodeId = path[path.length - 1];
  const node = useMemo(() => (help && nodeId ? help.tree[nodeId] : null), [help, nodeId]);

  function choose(label: string) {
    if (!node?.choices) return;
    const c = node.choices[label];
    if (c.steps) {
      setSteps(c.steps);
      setStepIdx(0);
    } else if (c.next && help?.tree[c.next]) {
      const target = help.tree[c.next];
      if (target.steps && !target.choices) {
        setSteps(target.steps);
        setStepIdx(0);
      }
      setPath((p) => [...p, c.next!]);
    }
  }

  function back() {
    if (steps) {
      if (stepIdx > 0) return setStepIdx((i) => i - 1);
      setSteps(null);
      // If we entered a solution node directly, pop it too.
      if (node?.steps && !node.choices && path.length > 1) setPath((p) => p.slice(0, -1));
      return;
    }
    if (path.length > 1) setPath((p) => p.slice(0, -1));
  }

  if (error) return <div className="error">Couldn’t load the guide: {error}</div>;
  if (!help || !node) return <div className="row muted"><span className="spinner" /> Loading guide…</div>;

  const canBack = steps ? true : path.length > 1;
  const category = node.category ?? (steps ? 'Fix' : undefined);

  return (
    <div>
      <div className="ts-meta">
        <button className="btn btn-ghost btn-sm" onClick={back} disabled={!canBack}>
          <BackIcon size={18} /> Back
        </button>
        <span>
          {help.bay ? `Bay ${help.bay.number}${help.bay.name ? ` · ${help.bay.name}` : ''} · ${labelLM(help.bay.launchMonitor)}` : 'Setup help'}
          {category ? ` · ${category}` : ''}
        </span>
      </div>

      {steps ? (
        <StepView step={steps[stepIdx]} index={stepIdx} total={steps.length} onNext={() => setStepIdx((i) => Math.min(i + 1, steps.length - 1))} onDone={() => { setSteps(null); setPath((p) => [p[0]]); }} />
      ) : (
        <>
          <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 16 }}>{node.prompt ?? 'What’s going on?'}</h2>
          <div className="ts-choices">
            {Object.keys(node.choices ?? {}).map((label) => (
              <button key={label} className="ts-choice" onClick={() => choose(label)}>
                <span>{label}</span>
                <ChevronIcon size={20} />
              </button>
            ))}
          </div>
          {nodeId !== help.commonNodeId && nodeId !== 'start' && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={() => setPath((p) => [...p, help.commonNodeId])}>
              Something else (screen, PC, projector, door…)
            </button>
          )}
        </>
      )}
    </div>
  );
}

function StepView({ step, index, total, onNext, onDone }: { step: TroubleshootStep; index: number; total: number; onNext: () => void; onDone: () => void }) {
  const last = index >= total - 1;
  return (
    <div className="ts-step">
      <div className="tiny" style={{ marginBottom: 8 }}>Step {index + 1} of {total}</div>
      {step.question && <h3>{step.question}</h3>}
      {step.subtext && <div className="sub">{step.subtext}</div>}
      {step.text && <div className="text">{step.text}</div>}
      {step.externalLink && (
        <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={() => kiosk.adminOpenExternal(step.externalLink!)}>
          Open link
        </button>
      )}
      <div className="row" style={{ marginTop: 22, justifyContent: 'flex-end' }}>
        {last ? (
          <button className="btn btn-primary" onClick={onDone}>{step.buttonText ?? 'Done'}</button>
        ) : (
          <button className="btn btn-primary" onClick={onNext}>{step.buttonText ?? 'Next'}</button>
        )}
      </div>
    </div>
  );
}

export function labelLM(lm: string | null | undefined): string {
  switch ((lm ?? '').toUpperCase()) {
    case 'IDRA': return 'Uneekor iDra';
    case 'SKYTRAK': return 'SkyTrak';
    case 'PROTEE_VX': return 'ProTee VX';
    default: return 'Launch monitor';
  }
}
