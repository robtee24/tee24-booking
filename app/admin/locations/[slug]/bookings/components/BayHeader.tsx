// app/admin/locations/[slug]/bookings/components/BayHeader.tsx
import type { Bay } from "@/types/bay";

type BayHeaderProps = {
  bays: Bay[];
};

export function BayHeader({ bays }: BayHeaderProps) {
  return (
    <>
      {bays.map((bay) => (
        <div
          key={bay.id}
          className={`
            px-3 py-2 text-sm font-medium border-b border-gray-300 truncate
            ${bay.disabled 
              ? "bg-gray-200/70 text-gray-500" 
              : "bg-gray-50 text-gray-900"
            }
          `}
        >
          <div className="flex items-center justify-between">
            <span>
              Bay {bay.number}
              {bay.name && <span className="ml-1 text-gray-500">({bay.name})</span>}
            </span>
            {bay.disabled && (
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.367zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
        </div>
      ))}
    </>
  );
}