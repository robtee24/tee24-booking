"use client";

import React from "react";
import { Button } from "@/components/ui";
import { CreditCard, Check, Copy } from "lucide-react";

export type SquareStatusProps = {
  configured: boolean;
  env: string;
  missingEnv: string[];
  requiredEnv: string[];
  optionalEnv: string[];
  webhookSignatureKeySet: boolean;
  webhookUrl: string;
};

/**
 * "Connect Square" callout. Shown on every billing page when Square is not
 * configured; the full variant (settings page) also lists optional env vars and
 * the webhook URL.
 */
export function SquareConnectCallout({ status, full = false }: { status: SquareStatusProps; full?: boolean }) {
  const [copied, setCopied] = React.useState<string | null>(null);
  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  if (status.configured && !full) return null;

  return (
    <div className={`rounded-apple border p-4 ${status.configured ? "border-apple-green/30 bg-apple-green/5" : "border-apple-orange/40 bg-apple-orange/5"}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${status.configured ? "bg-apple-green/15 text-apple-green" : "bg-apple-orange/15 text-apple-orange"}`}>
          {status.configured ? <Check className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-apple-base font-semibold text-apple-text">
            {status.configured ? `Square connected (${status.env})` : "Connect Square to accept card payments"}
          </h3>
          {!status.configured && (
            <p className="mt-1 text-apple-sm text-apple-text-secondary">
              Cards on file, automatic recurring charges, online signup payments and refunds are disabled. Manual payments (cash / check / other) still work.
              Set these environment variables on the deployment, then redeploy:
            </p>
          )}
          <ul className="mt-3 space-y-1.5 font-mono text-apple-xs">
            {status.requiredEnv.map((k) => {
              const missing = status.missingEnv.includes(k);
              return (
                <li key={k} className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${missing ? "bg-apple-red" : "bg-apple-green"}`} />
                  <span className={missing ? "text-apple-text" : "text-apple-text-secondary"}>{k}</span>
                  {missing && <span className="font-sans text-[10px] uppercase tracking-wide text-apple-red">missing</span>}
                </li>
              );
            })}
            {full &&
              status.optionalEnv.map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${k === "SQUARE_WEBHOOK_SIGNATURE_KEY" && status.webhookSignatureKeySet ? "bg-apple-green" : "bg-apple-border"}`} />
                  <span className="text-apple-text-secondary">{k}</span>
                  <span className="font-sans text-[10px] uppercase tracking-wide text-apple-text-tertiary">
                    {k === "SQUARE_ENV" ? "optional · sandbox | production (default production)" : k === "SQUARE_WEBHOOK_SIGNATURE_KEY" ? (status.webhookSignatureKeySet ? "set" : "optional · required for webhooks") : "optional"}
                  </span>
                </li>
              ))}
          </ul>
          {full && (
            <div className="mt-4">
              <div className="text-apple-xs font-medium text-apple-text-tertiary">Webhook notification URL (Square Developer Dashboard → Webhooks)</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-white px-2 py-1 font-mono text-apple-xs text-apple-text">{status.webhookUrl}</code>
                <Button size="sm" variant="secondary" iconLeft={copied === status.webhookUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={() => copy(status.webhookUrl)}>
                  {copied === status.webhookUrl ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-2 text-apple-xs text-apple-text-tertiary">
                Subscribe to: payment.updated, refund.updated, card.updated, card.disabled, card.forgotten, dispute.created.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
