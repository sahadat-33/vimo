'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitIsFullScreen?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type OrientationApi = { lock?: (o: string) => Promise<void>; unlock?: () => void };

/**
 * Watches fullscreen that belongs to the video player (YouTube's own iframe, or a <video>) and turns the phone landscape with it,
 * like the YouTube app. It never calls requestFullscreen itself, so the player keeps the user's tap.
 *
 * Everything is derived from what the browser reports NOW. It is re-checked on every related event, a few times after each one
 * (Android reports the final size late) and once a second, so a missed or reordered event can never leave the room stuck in cinema mode.
 */
export function useCinema(wrapRef: RefObject<HTMLElement | null>, enabled: boolean, landscape: boolean): { fs: boolean } {
  const [fs, setFs] = useState(false);
  const landscapeRef = useRef(landscape); landscapeRef.current = landscape;
  const locked = useRef(false); // we locked the screen to landscape for this fullscreen session
  const tried = useRef(false);  // ...and we only ask once per session
  const swapped = useRef(false); // we asked the room's container to take over the fullscreen (once per session)

  useEffect(() => {
    if (!enabled) { setFs(false); return; }
    const doc = document as FullscreenDocument;
    const orientation = () => screen.orientation as unknown as OrientationApi | undefined;
    const activeEl = (): Element | null => doc.fullscreenElement || doc.webkitFullscreenElement || null;
    const sync = () => {
      const wrap = wrapRef.current, el = activeEl();
      const inside = !!(wrap && el && (el === wrap || wrap.contains(el)));
      // Older WebKit has no fullscreen element, only a flag.
      const on = inside || (!!doc.webkitIsFullScreen && !!wrap?.querySelector('video, iframe'));
      setFs(on);
      // A player's own fullscreen (YouTube's iframe) shows only the iframe, so the chat toasts beside it would be hidden. Hand the
      // fullscreen to the room's container instead, which holds the player and the toasts. If the browser refuses, the video keeps playing as before.
      if (on && wrap && el && el !== wrap && wrap.contains(el) && (el.tagName === 'IFRAME' || el.tagName === 'VIDEO') && !swapped.current) {
        swapped.current = true;
        try { void wrap.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions).catch(() => { swapped.current = false; }); } catch { swapped.current = false; }
      }
      if (on && !landscapeRef.current && !tried.current) {
        // Tapped the player's fullscreen icon while upright: turn landscape, as the YouTube app does. Refusals are fine.
        tried.current = true;
        try { void Promise.resolve(orientation()?.lock?.('landscape')).then(() => { locked.current = true; }, () => {}); } catch {}
      }
      if (!on) {
        // Fullscreen is over (for whatever reason): hand rotation back to the phone.
        if (locked.current) { try { orientation()?.unlock?.(); } catch {} }
        locked.current = false; tried.current = false; swapped.current = false;
      }
    };
    let timers: ReturnType<typeof setTimeout>[] = [];
    const settle = () => { timers.forEach(clearTimeout); sync(); timers = [150, 500, 1200].map((ms) => setTimeout(sync, ms)); };
    const docEvents = ['fullscreenchange', 'webkitfullscreenchange', 'webkitbeginfullscreen', 'webkitendfullscreen', 'visibilitychange'];
    const winEvents = ['resize', 'orientationchange', 'pageshow', 'focus'];
    docEvents.forEach((e) => document.addEventListener(e, settle, true));
    winEvents.forEach((e) => addEventListener(e, settle));
    const watchdog = setInterval(sync, 1000); // safety net for any event the browser forgets to send
    settle();
    return () => {
      timers.forEach(clearTimeout); clearInterval(watchdog);
      docEvents.forEach((e) => document.removeEventListener(e, settle, true));
      winEvents.forEach((e) => removeEventListener(e, settle));
      if (locked.current) { try { orientation()?.unlock?.(); } catch {} }
      locked.current = false; tried.current = false;
    };
  }, [enabled, wrapRef]);

  // Turned the phone upright while the player is fullscreen (and we did not lock it): leave fullscreen, like a native app.
  const was = useRef(landscape);
  useEffect(() => {
    const wasLandscape = was.current; was.current = landscape;
    if (!enabled || !wasLandscape || landscape || locked.current) return;
    const doc = document as FullscreenDocument, wrap = wrapRef.current, el = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (!(wrap && el && (el === wrap || wrap.contains(el)))) return; // never touch a fullscreen element that is not ours
    if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {});
    else if (doc.webkitExitFullscreen) { try { void Promise.resolve(doc.webkitExitFullscreen()).catch(() => {}); } catch {} }
  }, [landscape, enabled, wrapRef]);

  return { fs };
}
