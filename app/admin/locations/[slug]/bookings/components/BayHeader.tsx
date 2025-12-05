// app/admin/locations/[slug]/bookings/components/BayHeader.tsx
import type { Bay } from "@/types/admin-booking";

type BayHeaderProps = {
  bays: Bay[];
};

export function BayHeader({ bays }: BayHeaderProps) {
  return (
    <>
      <div className="px-3 py-2 text-right text-gray-500 text-sm font-medium">Time</div>
      {bays.map((bay) => (
        <div key={bay.id} className="px-3 py-2 font-medium">
          Bay {bay.number}
        </div>
      ))}
    </>
  );
}