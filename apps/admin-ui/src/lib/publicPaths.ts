const PUBLIC_PATHS = ['/login', '/reset-password'];

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.includes(pathname);
}
