'use client';
import { useCallback, useEffect, useState, type RefObject } from 'react';

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitIsFullScreen?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/**
 * Tracks fullscreen owned by the video player without trying to steal its user
 * gesture. YouTube's iframe may be exposed as the fullscreen element on Chrome;
 * WebKit browsers use prefixed fullscreen events/properties. Both paths are
 * observed so the room can restore its normal chrome as soon as fullscreen ends.
 */
export function useCinema(
  wrapRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  landscape: boolean,
): { fs: boolean; pending: boolean; enter: () => Promise<boolean>; tap: () => Promise<void> } {
  const [fs, setFs] = useState(false);
  const [pending, setPending] = useState(false);

  const enter = useCallback(async (): Promise<boolean> => {
    // Do not call requestFullscreen here. YouTube's native control must retain
    // the original tap/user activation, especially inside its cross-origin iframe.
    setPending(false);
    return !!wrapRef.current;
  }, [wrapRef]);

  useEffect(() => {
    if (!enabled) {
      setFs(false);
      setPending(false);
      return;
    }

    const doc = document as FullscreenDocument;
    const isInside = () => {
      const wrap = wrapRef.current;
      const active = doc.fullscreenElement || doc.webkitFullscreenElement || null;
      if (wrap && active && (active === wrap || wrap.contains(active))) return true;
      // Older WebKit reports a boolean rather than the active element.
      return !!(wrap && doc.webkitIsFullScreen && wrap.querySelector('video, iframe'));
    };
    const update = () => {
      const active = isInside();
      setFs(active);
      if (active || !(doc.fullscreenElement || doc.webkitFullscreenElement || doc.webkitIsFullScreen)) {
        setPending(false);
      }
    };

    const events = ['fullscreenchange', 'webkitfullscreenchange', 'webkitbeginfullscreen', 'webkitendfullscreen'];
    events.forEach((event) => document.addEventListener(event, update, true));
    // Android Chrome sometimes dispatches the fullscreen event before the final
    // viewport resize. Recheck after resize/pageshow to avoid stale cinema state.
    window.addEventListener('resize', update);
    window.addEventListener('pageshow', update);
    update();
    return () => {
      events.forEach((event) => document.removeEventListener(event, update, true));
      window.removeEventListener('resize', update);
      window.removeEventListener('pageshow', update);
    };
  }, [enabled, wrapRef]);

  useEffect(() => {
    if (!enabled) return;
    const doc = document as FullscreenDocument;
    const activeInside = () => {
      const wrap = wrapRef.current;
      const active = doc.fullscreenElement || doc.webkitFullscreenElement || null;
      return !!wrap && !!active && (active === wrap || wrap.contains(active));
    };

    if (landscape) {
      // Manual rotation keeps the familiar one-tap hint, unless the player has
      // already entered fullscreen through its own native controls.
      setPending(!activeInside() && !doc.webkitIsFullScreen);
      return;
    }

    setPending(false);
    // If the phone is rotated upright while the room wrapper itself is fullscreen,
    // exit it. Never call exitFullscreen for a fullscreen element outside this room.
    if (activeInside()) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else if (doc.webkitExitFullscreen) {
        try { void Promise.resolve(doc.webkitExitFullscreen()).catch(() => {}); } catch {}
      }
    }
  }, [landscape, enabled, wrapRef]);

  const tap = useCallback(async () => {
    setPending(false);
  }, []);

  return { fs, pending, enter, tap };
}
