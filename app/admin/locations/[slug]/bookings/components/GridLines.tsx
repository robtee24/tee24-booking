// app/admin/locations/[slug]/bookings/components/GridLines.tsx
import { minutesToTop } from "@/lib/time-utils";

type GridLinesProps = {
  timeStep: number;
  pxPerMin: number;
  totalHeight: number;
};

export function GridLines({ timeStep, pxPerMin, totalHeight }: GridLinesProps) {
  const steps = Math.ceil(1440 / timeStep);

  return (
    <div className="absolute inset-0 pointer-events-none">
      {Array.from({ length: steps }, (_, i) => {
        const mins = i * timeStep;
        const isHour = mins % 60 === 0;
        return (
          <div
            key={i}
            className={`absolute left-0 right-0 border-t ${
              isHour ? "border-gray-300" : "border-gray-100"
            }`}
            style={{ top: minutesToTop(mins, pxPerMin) }}
          />
        );
      })}
    </div>
  );
}