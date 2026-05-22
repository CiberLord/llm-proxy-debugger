import { useEffect, useState } from "react";

export interface AsyncState<T> {
  loading: boolean;
  error?: string;
  data?: T;
}

/** Runs an async function and tracks loading / error / data state. */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[]
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ loading: true });

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    fn()
      .then((data) => {
        if (alive) setState({ loading: false, data });
      })
      .catch((err) => {
        if (alive) setState({ loading: false, error: String(err) });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
