import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowUpRight, Check, Code2, X, type LucideIcon } from 'lucide-react';
import { useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Snapshot, SourceRef } from '../data/types';
import { useWorkspace } from '../state/WorkspaceContext';

export function Button({
  children,
  icon: Icon,
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
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
}: {
  children: ReactNode;
  tone?: 'neutral' | 'violet' | 'green' | 'amber' | 'red' | 'blue';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
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
        if (navigate) go('/workspace');
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
