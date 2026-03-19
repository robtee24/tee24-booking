// app/admin/locations/[slug]/bookings/components/GridLines.tsx
import { minutesToTop } from "@/lib/time-utils";
import { cn } from "@/lib/utils";

type GridLinesProps = {
  timeStep: number;
  pxPerMin: number;
  totalHeight: number;
  className?: string;
};

export function GridLines({
  timeStep,
  pxPerMin,
  totalHeight,
  className,
}: GridLinesProps) {
  const steps = Math.ceil(1440 / timeStep);

  return (
    <div className={cn("absolute inset-0 pointer-events-none", className)}>
      {Array.from({ length: steps }, (_, i) => {
        const mins = i * timeStep;
        const isHour = mins % 60 === 0;

        return (
          <div
            key={i}
            className={`absolute left-0 right-0 border-t ${
              isHour ? "border-apple-border" : "border-apple-divider/50"
            }`}
            style={{ top: minutesToTop(mins, pxPerMin) }}
          />
        );
      })}
    </div>
  );
}
