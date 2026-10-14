// Vite uses '/' locally and '/sentinel/' for the separate GitHub Pages build.
export function sitePath(path = '') {
  return (import.meta.env.BASE_URL || '/') + path.replace(/^\//, '');
}
