import logoUrl from './assets/tee24-logo.png';

/** Tee24 Indoor Golf Center logo (same artwork as tee24.golf), green on transparent. */
export function Logo({ height = 56, className }: { height?: number; className?: string }) {
  return <img src={logoUrl} alt="Tee24 Indoor Golf Center" className={className} style={{ height, width: 'auto', display: 'block' }} draggable={false} />;
}
