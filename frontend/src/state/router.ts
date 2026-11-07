import { useCallback, useEffect, useState } from 'react';

export type Route = 'home' | 'search' | 'queue';
const ROUTES: Route[] = ['home', 'search', 'queue'];

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return (ROUTES as string[]).includes(hash) ? (hash as Route) : 'home';
}

/** Basit hash yönlendirme (#/home, #/search, #/queue) — tarayıcı geri tuşu çalışır. */
export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    if (readRoute() !== next) window.location.hash = `/${next}`;
    window.scrollTo({ top: 0 });
  }, []);

  return [route, navigate];
}
