// app/admin/locations/[slug]/bookings/components/TimeGutter.tsx
import { minutesToTop } from "@/lib/time-utils";
import { labelForHour } from "@/lib/time-utils";

type TimeGutterProps = {
  pxPerMin: number;
  totalHeight: number;
};

export function TimeGutter({ pxPerMin, totalHeight }: TimeGutterProps) {
  return (
    <div className="relative" style={{ height: totalHeight }}>
      {Array.from({ length: 25 }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-t text-right text-[10px] text-gray-500"
          style={{ top: minutesToTop(i * 60, pxPerMin) }}
        >
          <div className="-translate-y-1/2 px-2">{labelForHour(i)}</div>
        </div>
      ))}
    </div>
  );
}