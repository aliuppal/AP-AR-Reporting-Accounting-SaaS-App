import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

interface RouterValue {
  path: string;
  search: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function readLocation() {
  return { path: window.location.pathname, search: window.location.search };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(readLocation);

  useEffect(() => {
    const onChange = () => setLoc(readLocation());
    window.addEventListener('popstate', onChange);
    const originalPush = history.pushState.bind(history);
    const originalReplace = history.replaceState.bind(history);
    history.pushState = (...args: Parameters<History['pushState']>) => {
      originalPush(...args);
      setLoc(readLocation());
    };
    history.replaceState = (...args: Parameters<History['replaceState']>) => {
      originalReplace(...args);
      setLoc(readLocation());
    };
    return () => {
      window.removeEventListener('popstate', onChange);
      history.pushState = originalPush;
      history.replaceState = originalReplace;
    };
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (to === `${window.location.pathname}${window.location.search}`) return;
    if (opts?.replace) history.replaceState({}, '', to);
    else history.pushState({}, '', to);
    window.scrollTo({ top: 0 });
  }, []);

  const value = useMemo(() => ({ ...loc, navigate }), [loc, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider');
  return ctx;
}

export function useQueryParam(key: string, fallback = '') {
  const { search } = useRouter();
  const value = new URLSearchParams(search).get(key);
  return value ?? fallback;
}

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
}

export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      onClick={(event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onClick?.(event);
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/** Matches "/invoices/123" against a pattern like "/invoices/:id". */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}
