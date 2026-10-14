// Query routes survive direct visits and refreshes on GitHub Pages, which has no rewrites.
export function pagesHref(href, base = '/sentinel/') {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const url = new URL(href, 'https://sentinel.invalid');
  const issue = url.pathname.match(/^\/bugs\/(\d+)\/?$/);
  if (issue) url.searchParams.set('issue', issue[1]);
  else if (url.pathname !== '/') return base + href.slice(1);
  return base + (url.search ? url.search : '') + url.hash;
}
