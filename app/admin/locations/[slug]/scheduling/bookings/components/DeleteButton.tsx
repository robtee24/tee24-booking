// app/admin/locations/[slug]/bookings/components/DeleteButton.tsx
import { Trash2 } from "lucide-react";

type DeleteButtonProps = {
  onClick: (e: React.MouseEvent) => void;
};

export function DeleteButton({ onClick }: DeleteButtonProps) {
  return (
    <button
      className="rounded-apple-sm p-1 hover:bg-black/10 transition-opacity duration-150 opacity-0 group-hover:opacity-100"
      onClick={onClick}
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}
