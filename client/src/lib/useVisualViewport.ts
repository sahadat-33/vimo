'use client';
import { useEffect, useState } from 'react';

/**
 * The part of the screen the soft keyboard leaves free. Without it, Android and iPhone browsers pan the whole page up to reveal a focused
 * input, which pushes the video out of view while someone types. `kb` is true while the keyboard is open (the visible height has shrunk a lot).
 */
export function useVisualViewport() {
  const [v, setV] = useState({ top: 0, height: 0, kb: false });
  useEffect(() => {
    const vv = window.visualViewport; if (!vv) return;
    let base = vv.height, w = vv.width, raf = 0;
    const read = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (vv.width !== w) { w = vv.width; base = vv.height; } else base = Math.max(base, vv.height); // rotated or zoomed: measure again from here
        const kb = vv.height < base - 120;
        if (kb && window.scrollY) window.scrollTo(0, 0); // the page itself must not scroll away from the video
        setV((p) => (p.top === vv.offsetTop && p.height === vv.height && p.kb === kb ? p : { top: vv.offsetTop, height: vv.height, kb }));
      });
    };
    read(); vv.addEventListener('resize', read); vv.addEventListener('scroll', read);
    return () => { cancelAnimationFrame(raf); vv.removeEventListener('resize', read); vv.removeEventListener('scroll', read); };
  }, []);
  return v;
}
