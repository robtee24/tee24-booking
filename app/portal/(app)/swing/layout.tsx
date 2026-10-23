import { ToastProvider } from "@/components/ui/Toast";

// Swing Lab pages use toasts; the portal shell doesn't mount a provider.
export default function SwingLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
