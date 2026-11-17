"use client";

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot, type Query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

/**
 * Live Firestore reads, replacing fetch-on-navigation.
 *
 * Two things were wrong with the old approach and this fixes both at once.
 *
 * **The interface felt like it reloaded.** The shell refetched global settings
 * and the sidebar refetched the approval count with `pathname` in the
 * dependency array, so every navigation re-ran them and the topbar, the safe
 * mode banner and the badge all flickered — even though the layout itself never
 * remounts in the App Router.
 *
 * **It was also the expensive way to do it.** A 30-second poll over 123
 * companies is ~14,700 reads an hour whether or not anything changed. A
 * listener bills the documents it first reads, then one read per document that
 * actually changes. For data that is usually still, that is far cheaper — and
 * it is what makes the numbers move on their own.
 *
 * Listeners are torn down on unmount and re-established when the query identity
 * changes, so a business switch swaps cleanly.
 */

interface LiveState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Subscribes to one document.
 *
 * `path` is the full document path; pass `null` to stay idle (before a
 * workspace is known, for instance) rather than subscribing to a guessed path.
 */
export function useLiveDoc<T>(path: string | null): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({ data: null, loading: Boolean(path), error: null });

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, path),
      (snapshot) => {
        setState({
          data: snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as T) : null,
          loading: false,
          error: null
        });
      },
      (error) => {
        // Surface rather than swallow: a rules or connectivity failure that
        // renders as "no data" is the class of bug that had the app claiming an
        // autonomy setting the owner never saved.
        setState({ data: null, loading: false, error });
      }
    );

    return unsubscribe;
  }, [path]);

  return state;
}

/**
 * Subscribes to a query and returns its documents.
 *
 * `key` identifies the query for React: Firestore `Query` objects are rebuilt
 * on every render and are never referentially equal, so the effect must depend
 * on a caller-supplied string instead. Getting this wrong resubscribes on every
 * render — a listener storm that reads the whole result set each time.
 */
export function useLiveQuery<T>(buildQuery: () => Query | null, key: string): LiveState<T[]> {
  const [state, setState] = useState<LiveState<T[]>>({ data: null, loading: true, error: null });
  const build = useRef(buildQuery);
  build.current = buildQuery;

  useEffect(() => {
    const query = build.current();
    if (!query) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    const unsubscribe = onSnapshot(
      query,
      (snapshot) => {
        setState({
          data: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as T),
          loading: false,
          error: null
        });
      },
      (error) => setState({ data: null, loading: false, error })
    );

    return unsubscribe;
  }, [key]);

  return state;
}

/**
 * Fires when a query's result set changes, without holding the documents.
 *
 * Screens like the campaign overview derive their numbers from four
 * collections, so listening to each and re-deriving on every document would be
 * a large rewrite. This gives them the useful half: a signal to recompute,
 * debounced so a discovery run writing fifty companies triggers one recompute
 * rather than fifty.
 *
 * The first snapshot is skipped — the caller has already loaded once, and
 * recomputing immediately on connect would just double the initial read.
 */
export function useChangeSignal(buildQuery: () => Query | null, key: string, debounceMs = 3000): number {
  const [signal, setSignal] = useState(0);
  const build = useRef(buildQuery);
  build.current = buildQuery;

  useEffect(() => {
    const query = build.current();
    if (!query) return;

    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = onSnapshot(
      query,
      (snapshot) => {
        if (first) {
          first = false;
          return;
        }
        // Local echoes of our own pending writes would fire twice.
        if (snapshot.metadata.hasPendingWrites) return;

        clearTimeout(timer);
        timer = setTimeout(() => setSignal((n) => n + 1), debounceMs);
      },
      () => {
        // A listener that cannot connect simply stops updating; the screen keeps
        // whatever it last loaded rather than blanking.
      }
    );

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [key, debounceMs]);

  return signal;
}
