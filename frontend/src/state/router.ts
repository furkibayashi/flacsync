import { useCallback, useEffect, useState } from 'react';

export type Route = 'home' | 'discover' | 'search' | 'library' | 'queue' | 'settings' | 'artist';
const ROUTES: Route[] = ['home', 'discover', 'search', 'library', 'queue', 'settings', 'artist'];

interface Location {
  route: Route;
  /** "#/artist/15049" → "15049" */
  param: string | null;
}

function readLocation(): Location {
  const [head = '', param] = window.location.hash.replace(/^#\/?/, '').split(/[/?]/);
  const route = (ROUTES as string[]).includes(head) ? (head as Route) : 'home';
  return { route, param: param ? decodeURIComponent(param) : null };
}

/** Sanatçı profilini aç (her yerden çağrılabilir; hash değişince uygulama yönlenir). */
export function openArtist(id: string): void {
  window.location.hash = `/artist/${encodeURIComponent(id)}`;
  window.scrollTo({ top: 0 });
}

/** Basit hash yönlendirme (#/home, #/artist/123 …) — tarayıcı geri tuşu çalışır. */
export function useHashRoute(): [Route, (route: Route) => void, string | null] {
  const [location, setLocation] = useState<Location>(readLocation);

  useEffect(() => {
    const onChange = () => setLocation(readLocation());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    const current = readLocation();
    if (current.route !== next || current.param) window.location.hash = `/${next}`;
    window.scrollTo({ top: 0 });
  }, []);

  return [location.route, navigate, location.param];
}
