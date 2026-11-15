'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type Orient = { lock?: (o: string) => Promise<void>; unlock?: () => void };
const orient = () => (typeof screen === 'undefined' ? undefined : (screen.orientation as unknown as Orient | undefined));

/**
 * Real fullscreen for the video container on phones and touch tablets, the way a native player behaves.
 *  - Tapping the player's OWN fullscreen button (YouTube iframe, or the <video> controls) makes the browser fullscreen that element.
 *    We immediately move fullscreen to our container instead, so the video AND the floating chat stay visible, and lock landscape.
 *  - Turning the phone sideways asks for fullscreen on the container. Browsers only allow that after a tap, so if it is refused we report
 *    `pending`: the page then lays a transparent shield over the video and the next tap enters fullscreen. (A tap inside the cross-origin
 *    YouTube iframe never reaches our page, which is why a window-level tap listener cannot do this job.)
 *  - Turning the phone upright, or leaving fullscreen with the Back gesture, leaves fullscreen and hands rotation back to the phone.
 * `fs` is true while OUR container is the fullscreen element. iPhone Safari has no element fullscreen: there only the layout changes.
 */
export function useCinema(wrapRef: RefObject<HTMLElement | null>, enabled: boolean, landscape: boolean): { fs: boolean; pending: boolean; enter: () => Promise<boolean> } {
  const [fs, setFs] = useState(false), [pending, setPending] = useState(false);
  const live = useRef({ landscape, swapTried: false, ours: false });
  live.current.landscape = landscape;

  const enter = useCallback(async (): Promise<boolean> => {
    const el = wrapRef.current; if (!el) return false;
    if (document.fullscreenElement === el) return true;
    try { await el.requestFullscreen({ navigationUI: 'hide' }); return true; } catch { return false; } // refused: no recent tap, or unsupported
  }, [wrapRef]);

  useEffect(() => { // 1. any fullscreen change: adopt the player's own fullscreen, lock landscape on entry, unlock on exit
    if (!enabled) return;
    const onChange = async () => {
      const fe = document.fullscreenElement, el = wrapRef.current;
      setFs(!!el && fe === el); if (el && fe === el) setPending(false);
      if (!fe) { live.current.swapTried = false; live.current.ours = false; try { orient()?.unlock?.(); } catch {} return; } // left fullscreen
      if (fe === el) live.current.ours = true;
      if (el && fe !== el && el.contains(fe)) {
        // We sit on top of the player's own fullscreen. If our level was just closed (Back gesture, turned upright), close the one underneath
        // too, otherwise the user lands in the player's fullscreen and needs a second Back.
        if (live.current.ours) { live.current.ours = false; void document.exitFullscreen().catch(() => {}); return; }
        if (!live.current.swapTried) { live.current.swapTried = true; if (await enter()) return; } // the player went fullscreen on its own: take it over once
      }
      if (!live.current.landscape) { try { void orient()?.lock?.('landscape').catch(() => {}); } catch {} } // entered while upright: turn the screen like a native player
    };
    document.addEventListener('fullscreenchange', onChange); return () => document.removeEventListener('fullscreenchange', onChange);
  }, [enabled, enter, wrapRef]);

  useEffect(() => { // 2. physical rotation
    if (!enabled) return;
    if (!landscape) { setPending(false); if (document.fullscreenElement === wrapRef.current) void document.exitFullscreen().catch(() => {}); return; } // turned upright
    let alive = true;
    void enter().then((ok) => { if (alive) setPending(!ok); }); // refused (no recent tap): ask the page to offer a tap target
    return () => { alive = false; };
  }, [landscape, enabled, enter, wrapRef]);

  return { fs, pending, enter };
}
