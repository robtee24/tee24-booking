// types/bay.ts
export type BayKind = "SINGLE" | "GROUP";
export type Handedness = "RH" | "LH" | null;

export type Bay = {
  id: string;
  number: number;
  name: string | null;
  kind: BayKind;
  handedness: Handedness;
  capacity: number;
  locationId: string;
};

export type BayInfo = Omit<Bay, "locationId">;
export type BaySummary = Pick<Bay, "number" | "kind" | "handedness" | "capacity">;