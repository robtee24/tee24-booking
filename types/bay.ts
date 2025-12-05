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
  disabled: boolean;
};

export type CreateBayInput = {
  number: number;
  name?: string | null;
  kind: "SINGLE" | "GROUP";
  handedness?: "RH" | "LH" | null;
  capacity?: number;
  disabled?: boolean;
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

export type BaySummary = Pick<Bay, "number" | "kind" | "handedness" | "capacity" | "disabled">;
export type PublicBaySummary = Pick<Bay, "number" | "kind" | "handedness" | "capacity">;

export type AdminBayRow = BayInfo;