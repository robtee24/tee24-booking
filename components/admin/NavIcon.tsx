import {
  LayoutDashboard,
  CalendarDays,
  Users,
  CreditCard,
  Megaphone,
  Settings,
  Building2,
  MapPin,
  ShieldCheck,
  AppWindow,
  Bell,
  CheckSquare,
  Wrench,
  DoorOpen,
  LogIn,
  Inbox,
  Smartphone,
} from "lucide-react";
import type { NavIcon as NavIconName } from "@/lib/admin/routes";

const ICONS = {
  dashboard: LayoutDashboard,
  calendar: CalendarDays,
  users: Users,
  card: CreditCard,
  megaphone: Megaphone,
  settings: Settings,
  building: Building2,
  "map-pin": MapPin,
  shield: ShieldCheck,
  "app-window": AppWindow,
  bell: Bell,
  "check-square": CheckSquare,
  wrench: Wrench,
  "door-open": DoorOpen,
  "log-in": LogIn,
  inbox: Inbox,
  smartphone: Smartphone,
} as const;

export function NavIcon({ name, className = "h-4 w-4" }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name] ?? LayoutDashboard;
  return <Icon className={className} aria-hidden />;
}
