import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowUpRight, Check, Code2, X, type LucideIcon } from 'lucide-react';
import { useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCardTilt, useHeroAnimation, useMagnetic } from '../animations/gsapHooks';
import type { Snapshot, SourceRef } from '../data/types';
import { useWorkspace } from '../state/WorkspaceContext';
import { BlueprintPattern } from './BlueprintPattern';

export function Button({
  children,
  icon: Icon,
  variant = 'secondary',
  className = '',
  magnetic = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  magnetic?: boolean;
}) {
  const magneticRef = useMagnetic<HTMLButtonElement>(magnetic ? 0.22 : 0);

  return (
    <button
      ref={magnetic ? magneticRef : undefined}
      className={`button button-${variant} ${className}`}
      {...props}
    >
      {Icon && <Icon size={15} strokeWidth={1.8} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button className={`icon-button ${className}`} title={label} aria-label={label} {...props}>
      <Icon size={16} strokeWidth={1.7} />
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'violet' | 'green' | 'amber' | 'red' | 'blue';
  className?: string;
}) {
  return <span className={`badge badge-${tone} ${className}`}>{children}</span>;
}

export function TiltCard({
  children,
  className = '',
  maxTilt = 6,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  className?: string;
  maxTilt?: number;
}) {
  const tiltRef = useCardTilt<HTMLDivElement>(maxTilt);

  return (
    <div ref={tiltRef} className={`tilt-card ${className}`} {...props}>
      {children}
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
  showBlueprint = true,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  showBlueprint?: boolean;
}) {
  const heroRef = useHeroAnimation<HTMLDivElement>();

  return (
    <div ref={heroRef} className="page-heading relative overflow-hidden">
      {showBlueprint && <BlueprintPattern position="right" opacity={0.06} />}
      <div className="relative z-10">
        <div className="eyebrow hero-eyebrow">{eyebrow}</div>
        <h1 className="hero-title">{title}</h1>
        <p className="hero-desc">{description}</p>
      </div>
      {actions && <div className="heading-actions hero-actions relative z-10">{actions}</div>}
    </div>
  );
}

export function PanelHeading({
  icon: Icon,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <h2>
        {Icon && <Icon size={16} />}
        {title}
      </h2>
      <div className="row gap-8">{children}</div>
    </div>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  const previousFocus = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className={`dialog ${className}`}
          onOpenAutoFocus={() => {
            previousFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            previousFocus.current?.focus();
          }}
        >
          <div className="dialog-header">
            <div>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description>{description}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton icon={X} label="Close dialog" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function SourceLink({
  source,
  children,
  navigate = false,
  snapshot,
}: {
  source: SourceRef;
  children?: ReactNode;
  navigate?: boolean;
  snapshot?: Snapshot;
}) {
  const { openSource } = useWorkspace();
  const go = useNavigate();
  return (
    <button
      className="source-link"
      title={`${source.path}:${source.start}–${source.end}`}
      onClick={() => {
        openSource(source, snapshot);
        if (navigate) go('/demo-workspace');
        setTimeout(
          () =>
            document.querySelector('.code-panel')?.scrollIntoView({
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'instant'
                : 'smooth',
              block: 'center',
            }),
          80,
        );
      }}
    >
      <Code2 size={13} />
      <span>{children ?? `${source.path.split('/').at(-1)}:${source.start}–${source.end}`}</span>
      <ArrowUpRight size={12} />
    </button>
  );
}

export function ChecklistItem({ checked, children }: { checked: boolean; children: ReactNode }) {
  return (
    <div className={`checklist-item ${checked ? 'checked' : ''}`}>
      <span className="check-circle">{checked ? <Check size={11} strokeWidth={3} /> : null}</span>
      <span>{children}</span>
    </div>
  );
}

export function DemoNote({ children }: { children?: ReactNode }) {
  return (
    <div className="demo-note">
      <span className="demo-dot" />
      {children ?? 'Sample repository · source and analysis are prepared demo fixtures'}
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label="Completion"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
    </div>
  );
}
