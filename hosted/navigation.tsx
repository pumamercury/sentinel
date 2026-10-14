import { useSyncExternalStore } from 'react';
import { pagesHref } from './routes.mjs';
const base = import.meta.env.BASE_URL;
const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  return () => window.removeEventListener('popstate', notify);
};
export function useSearchParams() {
  const search = useSyncExternalStore(
    subscribe,
    () => location.search,
    () => '',
  );
  return new URLSearchParams(search);
}
const router = {
  push(href: string) {
    history.pushState(null, '', pagesHref(href, base));
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.scrollTo(0, 0);
  },
  replace(href: string) {
    history.replaceState(null, '', pagesHref(href, base));
    window.dispatchEvent(new PopStateEvent('popstate'));
  },
};
export const useRouter = () => router;
