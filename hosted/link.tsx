import type { AnchorHTMLAttributes } from 'react';
import { pagesHref } from './routes.mjs';
import { useRouter } from './navigation';
export default function Link({
  href = '/',
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const router = useRouter();
  return (
    <a
      {...props}
      href={pagesHref(href, import.meta.env.BASE_URL)}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target ||
          props.download ||
          !href.startsWith('/') ||
          href.startsWith('//')
        )
          return;
        event.preventDefault();
        router.push(href);
      }}
    />
  );
}
