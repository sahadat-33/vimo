'use client';
import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { useVisualViewport } from '@/lib/useVisualViewport';
import { ArrowRight, X, Eye, EyeOff, Loader2, Lock } from 'lucide-react';

export const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export function Logo({ size = 40, text = true }: { size?: number; text?: boolean }) {
  return <div className="flex items-center gap-2.5">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/vimo-mark.png" alt="" width={size} height={size} style={{ width: size, height: 'auto' }} />
    {text && <span className="text-2xl font-semibold lowercase leading-none tracking-tight">vimo</span>}
  </div>;
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx('rounded-card border border-white/5 bg-surface p-6 shadow-card', className)}>{children}</div>;
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost'; loading?: boolean };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(({ variant = 'primary', loading, disabled, className, children, ...p }, ref) => (
  <button ref={ref} disabled={disabled || loading} aria-busy={loading}
    className={cx('flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-5 font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50',
      variant === 'primary' ? 'bg-primary text-white shadow-glow hover:bg-[#7A35A6]' : 'bg-surface2 text-ink hover:bg-[#25214a]', className)} {...p}>
    {loading && <Loader2 size={18} className="animate-spin" aria-hidden />}{children}</button>));
Button.displayName = 'Button';

export function TextField({ label, error, className, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const id = useId();
  return <div className="space-y-1.5"><label htmlFor={id} className="text-sm font-medium text-muted">{label}</label>
    <input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined}
      className={cx('min-h-[48px] w-full rounded-xl border bg-surface2 px-4 text-ink placeholder:text-muted/60 disabled:opacity-50', error ? 'border-accent' : 'border-white/10 focus:border-secondary', className)} {...p} />
    {error && <p id={`${id}-e`} role="alert" className="text-sm text-accent">{error}</p>}</div>;
}

export function PasswordField({ label, error, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const [show, setShow] = useState(false); const id = useId();
  return <div className="space-y-1.5"><label htmlFor={id} className="text-sm font-medium text-muted">{label}</label>
    <div className="relative">
      <Lock size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
      <input id={id} type={show ? 'text' : 'password'} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined} autoComplete="current-password"
        className={cx('min-h-[48px] w-full rounded-xl border bg-surface2 pl-11 pr-12 text-ink placeholder:text-muted/60 disabled:opacity-50', error ? 'border-accent' : 'border-white/10 focus:border-secondary')} {...p} />
      <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? 'Hide passcode' : 'Show passcode'}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted hover:text-ink">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
    {error && <p id={`${id}-e`} role="alert" className="text-sm text-accent">{error}</p>}</div>;
}

export function StatusPill({ online, label, title, compact }: { online: boolean | null; label: string; title?: string; compact?: boolean }) {
  return <span title={title} className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface2 text-muted', compact ? 'px-2 py-0.5 text-xs' : 'gap-2 px-3 py-1 text-sm')}>
    <span className={cx('h-2 w-2 rounded-full', online ? 'bg-emerald-400' : online === null ? 'bg-muted' : 'bg-accent')} aria-hidden />{label}</span>;
}

export function ModeCard({ icon, title, desc, tag, onClick }: { icon: React.ReactNode; title: string; desc: string; tag: string; onClick: () => void }) {
  return <button onClick={onClick} className="group flex w-full min-w-0 flex-col gap-4 rounded-card border border-white/5 bg-gradient-to-b from-surface2 to-surface p-6 text-left shadow-card transition hover:-translate-y-0.5 hover:border-secondary/50 hover:shadow-glow">
    <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/20 text-secondary">{icon}</span>
    <span className="space-y-1"><span className="block text-lg font-semibold">{title}</span><span className="block text-sm leading-relaxed text-muted">{desc}</span></span>
    <span className="mt-auto flex items-center justify-between text-sm"><span className="rounded-full bg-surface px-2.5 py-0.5 text-muted">{tag}</span>
      <ArrowRight size={18} className="text-secondary transition group-hover:translate-x-1" aria-hidden /></span></button>;
}

export function IconButton({ label, active, danger, badge, className, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; danger?: boolean; badge?: number }) {
  return <button aria-label={label} title={label} aria-pressed={active} {...p}
    className={cx('relative grid h-9 w-9 shrink-0 place-items-center rounded-xl transition active:scale-95 disabled:opacity-50 min-[380px]:h-10 min-[380px]:w-10 sm:h-11 sm:w-11',
      danger ? 'bg-accent/20 text-accent hover:bg-accent/30' : active ? 'bg-primary text-white' : 'bg-surface2 text-ink hover:bg-[#25214a]', className)}>
    {children}{!!badge && <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-bold text-bg">{badge}</span>}</button>;
}

export function Skeleton({ className }: { className?: string }) { return <div aria-hidden className={cx('animate-pulse rounded-xl bg-surface2', className)} />; }

export function TabBar<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; badge?: number }[]; value: T; onChange: (t: T) => void; label: string }) {
  const move = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value); const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (d) { e.preventDefault(); const n = tabs[(i + d + tabs.length) % tabs.length].id; onChange(n); }
  };
  return <div role="tablist" aria-label={label} onKeyDown={move} className="flex gap-1 border-b border-white/5 p-1.5">
    {tabs.map((t) => <button key={t.id} role="tab" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)}
      className={cx('flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition', value === t.id ? 'bg-primary/20 text-secondary' : 'text-muted hover:text-ink')}>
      {t.label}{!!t.badge && <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-bg">{t.badge}</span>}</button>)}</div>;
}

/** Bottom sheet on phones, centred dialog on larger screens. Closes on Escape or a tap outside. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), vv = useVisualViewport();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null; ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k); return () => { removeEventListener('keydown', k); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className={cx('fixed z-[60] flex items-end justify-center sm:items-center', vv.kb ? 'inset-x-0' : 'inset-0')} style={vv.kb ? { top: vv.top, height: vv.height } : undefined}>
    <button aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-black/60" />
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
      className="relative flex max-h-[85%] w-full max-w-md animate-[sheetIn_.2s_ease-out] flex-col rounded-t-3xl border border-white/10 bg-surface shadow-card outline-none sm:rounded-3xl">
      <div className="flex items-center justify-between px-5 pb-2 pt-4"><h2 className="text-lg font-semibold">{title}</h2>
        <button aria-label="Close" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-surface2"><X size={18} /></button></div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">{children}</div></div></div>;
}
