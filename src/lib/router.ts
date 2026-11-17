import { useEffect, useState } from 'react';

/** Minimal hash router: #/incidents/INC-1003 -> ['incidents', 'INC-1003'] */
function parse(): string[] {
  const h = window.location.hash.replace(/^#\/?/, '');
  const parts = h.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  return parts.length ? parts : ['overview'];
}

export function useRoute(): string[] {
  const [route, setRoute] = useState<string[]>(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('/') ? path : `/${path}`;
}

export function href(path: string): string {
  return `#${path.startsWith('/') ? path : `/${path}`}`;
}
