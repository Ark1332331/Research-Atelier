'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LegacyPersonalization({ tab }: { tab: 'profile' | 'teaching' }) {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('view', 'personalization'); params.set('tab', tab);
    const hash = window.location.hash;
    if (hash.startsWith('#profile-')) params.set('item', hash.slice('#profile-'.length));
    else if (hash.startsWith('#memory-')) params.set('item', hash.slice('#memory-'.length));
    else if (hash === '#observations' && !params.has('observation')) params.set('panel', 'observations');
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [router, tab]);
  return <p className="personal-empty">正在打开个性化…</p>;
}
