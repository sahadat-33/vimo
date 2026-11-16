'use client';
import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Mobile cinema layout is driven by the device's actual orientation. We deliberately
 * do NOT replace a YouTube iframe's native fullscreen session with a fullscreen
 * request on our wrapper: that request runs from `fullscreenchange`, where Android
 * browsers may have already discarded the user's activation. Taking over there was
 * the source of the extra "Tap for fullscreen" prompt and stuck fullscreen states.
 *
 * Physical rotation still gets the one-tap hint. The hint simply dismisses on tap;
 * YouTube's own fullscreen button remains responsible for entering/exiting its native
 * fullscreen mode. The wrapper also recognizes fullscreen on any descendant player.
 */
export function useCinema(
  wrapRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  landscape: boolean,
): { fs: boolean; pending: boolean; enter: () => Promise<boolean>; tap: () => Promise<void> } {
  const [fs, setFs] = useState(false);
  const [pending, setPending] = useState(false);
  const enter = useCallback(async (): Promise<boolean> => {
    // Do not call requestFullscreen here. Native player controls (especially the
    // cross-origin YouTube iframe) must own their fullscreen user gesture.
    setPending(false);
    return !!wrapRef.current;
  }, [wrapRef]);

  useEffect(() => {
    if (!enabled) return;
    const update = () => {
      const el = wrapRef.current;
      const active = document.fullscreenElement;
      const inside = !!el && !!active && (active === el || el.contains(active));
      setFs(inside);
      if (inside || !active) setPending(false);
    };
    document.addEventListener('fullscreenchange', update);
    update();
    return () => document.removeEventListener('fullscreenchange', update);
  }, [enabled, wrapRef]);

  useEffect(() => {
    if (!enabled) return;
    const activeInside = () => {
      const el = wrapRef.current;
      const active = document.fullscreenElement;
      return !!el && !!active && (active === el || el.contains(active));
    };

    if (landscape) {
      // If the player already entered native fullscreen, don't put a tap shield
      // over its controls. Otherwise retain the familiar one-tap landscape hint.
      setPending(!activeInside() && !!document.fullscreenEnabled);
      return;
    }

    setPending(false);
    // If the device is turned upright while the player is fullscreen, close that
    // player fullscreen session as well so the normal room chrome is restored.
    if (activeInside()) void document.exitFullscreen().catch(() => {});
  }, [landscape, enabled, wrapRef]);

  const tap = useCallback(async () => {
    setPending(false);
  }, []);

  return { fs, pending, enter, tap };
}
