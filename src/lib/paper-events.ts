"use client";

export function announcePaperChange() {
  window.dispatchEvent(new Event('papers-changed'));
  try { const channel = new BroadcastChannel('research-papers'); channel.postMessage('changed'); channel.close(); } catch { /* local updates still work */ }
}
export function watchPaperChanges(refresh: () => void) {
  window.addEventListener('papers-changed', refresh);
  window.addEventListener('focus', refresh);
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel('research-papers'); channel.onmessage = refresh; } catch {}
  return () => { window.removeEventListener('papers-changed', refresh); window.removeEventListener('focus', refresh); channel?.close(); };
}
