/**
 * Troubleshooting decision tree shared by the bay kiosk ("Help" button) and the
 * public troubleshooting guide. The tree lives in `troubleshooting-tree.json`
 * (originally from the Tee24-Troubleshooting-Guide project) and is served to
 * kiosks via /api/bay-app/help so edits ship without reinstalling the kiosk.
 *
 * Node shapes:
 *   Decision: { prompt, category?, choices: { [label]: { next } | { steps } } }
 *   Solution: { category?, steps: Step[] }
 *   Step:     { question?, subtext?, text?, buttonText?, externalLink? }
 */
import tree from "./troubleshooting-tree.json";
import type { LaunchMonitor } from "@/types/bay";

export type TroubleshootStep = {
  question?: string;
  subtext?: string;
  text?: string;
  buttonText?: string;
  externalLink?: string;
};

export type TroubleshootChoice = { next?: string; steps?: TroubleshootStep[] };

export type TroubleshootNode = {
  prompt?: string;
  category?: string;
  choices?: Record<string, TroubleshootChoice>;
  steps?: TroubleshootStep[];
};

export type TroubleshootTree = Record<string, TroubleshootNode>;

export const TROUBLESHOOTING_TREE = tree as unknown as TroubleshootTree;

/** Which menu a bay should land on first, based on its launch monitor. */
export const ENTRY_NODE_BY_LAUNCH_MONITOR: Record<LaunchMonitor, string> = {
  IDRA: "idra_menu",
  SKYTRAK: "skytrak_menu",
  PROTEE_VX: "protee_menu",
  OTHER: "common_menu",
};

/** Non-simulator issues (monitor/PC/projector/door access/etc). */
export const COMMON_NODE_ID = "common_menu";

export function entryNodeFor(launchMonitor: LaunchMonitor | string | null | undefined): string {
  const key = String(launchMonitor ?? "OTHER").toUpperCase() as LaunchMonitor;
  return ENTRY_NODE_BY_LAUNCH_MONITOR[key] ?? COMMON_NODE_ID;
}
