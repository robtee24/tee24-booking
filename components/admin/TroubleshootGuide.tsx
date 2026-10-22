"use client";

import React from "react";
import { ArrowLeft, ChevronRight, ExternalLink, RotateCcw } from "lucide-react";
import type { TroubleshootTree, TroubleshootStep } from "@/lib/kiosk/troubleshooting";

/**
 * Walks the troubleshooting decision tree (same data the kiosk's Help button uses).
 * Decision nodes show choices; solution nodes show steps one at a time.
 */
export function TroubleshootGuide({ tree, entryNodeId }: { tree: TroubleshootTree; entryNodeId: string }) {
  const [stack, setStack] = React.useState<string[]>([entryNodeId]);
  const [steps, setSteps] = React.useState<TroubleshootStep[] | null>(null);
  const [stepIdx, setStepIdx] = React.useState(0);

  React.useEffect(() => {
    setStack([entryNodeId]);
    setSteps(null);
    setStepIdx(0);
  }, [entryNodeId]);

  const nodeId = stack[stack.length - 1];
  const node = tree[nodeId];

  function choose(choice: { next?: string; steps?: TroubleshootStep[] }) {
    if (choice.next && tree[choice.next]) {
      const n = tree[choice.next];
      if (n.steps && !n.choices) {
        setSteps(n.steps);
        setStepIdx(0);
      }
      setStack((s) => [...s, choice.next!]);
    } else if (choice.steps) {
      setSteps(choice.steps);
      setStepIdx(0);
    }
  }

  function back() {
    if (steps) {
      if (stepIdx > 0) return setStepIdx((i) => i - 1);
      setSteps(null);
      // If the current node is a pure solution node, pop it too.
      if (node?.steps && !node?.choices && stack.length > 1) setStack((s) => s.slice(0, -1));
      return;
    }
    if (stack.length > 1) setStack((s) => s.slice(0, -1));
  }

  function reset() {
    setStack([entryNodeId]);
    setSteps(null);
    setStepIdx(0);
  }

  const atRoot = stack.length === 1 && !steps;

  return (
    <div className="rounded-apple border border-apple-divider bg-white shadow-apple">
      <div className="flex items-center justify-between gap-2 border-b border-apple-divider px-4 py-2.5">
        <button type="button" onClick={back} disabled={atRoot} className="inline-flex items-center gap-1 text-apple-sm font-medium text-apple-text-secondary hover:text-apple-text disabled:opacity-40">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {node?.category && <span className="text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">{node.category}</span>}
        <button type="button" onClick={reset} disabled={atRoot} className="inline-flex items-center gap-1 text-apple-sm font-medium text-apple-text-secondary hover:text-apple-text disabled:opacity-40">
          <RotateCcw className="h-4 w-4" /> Start over
        </button>
      </div>

      <div className="p-4 sm:p-5">
        {steps ? (
          <StepView step={steps[stepIdx]} index={stepIdx} total={steps.length} onNext={() => setStepIdx((i) => Math.min(i + 1, steps.length - 1))} onDone={reset} />
        ) : !node ? (
          <p className="text-apple-sm text-apple-text-tertiary">This guide section is missing.</p>
        ) : node.choices ? (
          <>
            <h3 className="text-apple-lg font-semibold text-apple-text">{node.prompt ?? "What's the problem?"}</h3>
            <ul className="mt-3 divide-y divide-apple-divider rounded-apple-sm border border-apple-border">
              {Object.entries(node.choices).map(([label, choice]) => (
                <li key={label}>
                  <button type="button" onClick={() => choose(choice)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-apple-sm font-medium text-apple-text hover:bg-apple-fill-secondary">
                    {label}
                    <ChevronRight className="h-4 w-4 shrink-0 text-apple-text-tertiary" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : node.steps ? (
          <StepView step={node.steps[0]} index={0} total={node.steps.length} onNext={() => { setSteps(node.steps!); setStepIdx(1); }} onDone={reset} />
        ) : null}
      </div>
    </div>
  );
}

function StepView({ step, index, total, onNext, onDone }: { step: TroubleshootStep; index: number; total: number; onNext: () => void; onDone: () => void }) {
  const last = index >= total - 1;
  return (
    <div>
      <div className="mb-2 text-apple-xs font-medium text-apple-text-tertiary">Step {index + 1} of {total}</div>
      {step.question && <h3 className="text-apple-lg font-semibold text-apple-text">{step.question}</h3>}
      {step.text && <p className="mt-2 whitespace-pre-line text-apple-base text-apple-text">{step.text}</p>}
      {step.subtext && <p className="mt-2 whitespace-pre-line text-apple-sm text-apple-text-secondary">{step.subtext}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        {step.externalLink && (
          <a href={step.externalLink} target="_blank" rel="noreferrer" className="btn-secondary inline-flex items-center gap-1.5">
            Open link <ExternalLink className="h-4 w-4" />
          </a>
        )}
        {last ? (
          <button type="button" onClick={onDone} className="btn-primary">{step.buttonText ?? "Done"}</button>
        ) : (
          <button type="button" onClick={onNext} className="btn-primary">{step.buttonText ?? "Next"}</button>
        )}
      </div>
    </div>
  );
}
