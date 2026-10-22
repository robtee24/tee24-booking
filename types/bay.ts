// types/bay.ts
export type BayKind = "SINGLE" | "GROUP";
export type Handedness = "RH" | "LH" | null;
export type LaunchMonitor = "IDRA" | "SKYTRAK" | "PROTEE_VX" | "OTHER";

export const LAUNCH_MONITOR_LABELS: Record<LaunchMonitor, string> = {
  IDRA: "IDRA (Golfin)",
  SKYTRAK: "SkyTrak",
  PROTEE_VX: "ProTee VX",
  OTHER: "Other",
};

export type Bay = {
  id: string;
  number: number;
  name: string | null;
  kind: BayKind;
  handedness: Handedness;
  capacity: number;
  locationId: string;
  disabled: boolean;
  launchMonitor?: LaunchMonitor;
  setupNotes?: string | null;
};

export type CreateBayInput = {
  number: number;
  name?: string | null;
  kind: "SINGLE" | "GROUP";
  handedness?: "RH" | "LH" | null;
  capacity?: number;
  disabled?: boolean;
  launchMonitor?: LaunchMonitor;
  setupNotes?: string | null;
};

export type UpdateBayInput = Partial<CreateBayInput> & { bayId: string };

export type BayScheduleBooking = {
  id: string;
  start: string;
  end: string;
  firstName: string | null;
  lastName: string | null;
};

export type BaySchedule = {
  bay: {
    id: string;
    number: number;
    name: string | null;
  };
  dateISO: string;
  bookings: BayScheduleBooking[];
};

export type BayInfo = Omit<Bay, "locationId">;

/** BayInfo + kiosk registration state, as returned by the admin bays API */
export type AdminBayRow = BayInfo & {
  launchMonitor: LaunchMonitor;
  setupNotes: string | null;
  kiosk: {
    registered: boolean;
    deviceId: string | null;
    lastSeenAt: string | null;
    appVersion: string | null;
    hostname: string | null;
    online: boolean;
  };
};

export type BaySummary = Pick<Bay, "number" | "kind" | "handedness" | "capacity" | "disabled">;
export type PublicBaySummary = Pick<Bay, "number" | "kind" | "handedness" | "capacity">;
