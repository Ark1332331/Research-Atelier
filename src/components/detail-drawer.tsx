'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Native modal semantics keep keyboard focus inside and reading panels beneath it inert. */
export default function DetailDrawer({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null), heading = useId();
  useEffect(() => {
    const dialog = ref.current!, previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = 'hidden';
    return () => {
      dialog.close(); document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className="detail-drawer personal-ui" aria-labelledby={heading}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header className="drawer-head"><h2 id={heading}>{title}</h2><button type="button" className="personal-icon" aria-label="关闭侧栏" disabled={busy} onClick={onClose}>×</button></header>
    <div className="drawer-body">{children}</div>
  </dialog>;
}
