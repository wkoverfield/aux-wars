import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A scroll container with edge fades that appear ONLY when there's more content
 * in that direction — a subtle "there's more" cue that dissolves into the
 * background color. No visible chrome, so it never fights the styling.
 *
 * Props:
 *  - className:        layout/size classes for the outer box (must give it a
 *                      bounded height, e.g. "flex-1 min-h-0", "h-full", "max-h-80")
 *  - contentClassName: classes for the inner content (padding, flex, gap, etc.)
 *  - fadeColor:        color the edges fade to — match the local bg. Default #121212.
 *  - fade:             px height of each fade. Default 36.
 *  - showTop/showBottom: toggle a given edge (e.g. off when a sticky header sits there).
 */
export default function ScrollFade({
  children,
  className = '',
  contentClassName = '',
  fadeColor = '#121212',
  fade = 36,
  showTop = true,
  showBottom = true,
  scrollClassName = 'h-full w-full', // use e.g. "max-h-80 w-full" for max-height containers
}) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const overflowing = scrollHeight - clientHeight > 2;
    setEdges({
      top: overflowing && scrollTop > 2,
      bottom: overflowing && scrollTop < scrollHeight - clientHeight - 2,
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [update]);

  return (
    <div className={`relative ${className}`}>
      <div ref={scrollRef} className={`${scrollClassName} overflow-y-auto`}>
        <div ref={contentRef} className={contentClassName}>{children}</div>
      </div>
      {showTop && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 transition-opacity duration-200"
          style={{ height: fade, background: `linear-gradient(${fadeColor}, transparent)`, opacity: edges.top ? 1 : 0 }}
        />
      )}
      {showBottom && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 transition-opacity duration-200"
          style={{ height: fade, background: `linear-gradient(to top, ${fadeColor}, transparent)`, opacity: edges.bottom ? 1 : 0 }}
        />
      )}
    </div>
  );
}
