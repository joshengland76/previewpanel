import { useLayoutEffect, useRef, useState } from "react";

// Shrinks font-size (from maxSize down to minSize, in `step` decrements)
// until the text fits on one line within its parent's actual width --
// measured against the REAL rendered width on the user's own device and
// browser, not a single desktop test. A static px guess can't account for
// cross-device font-metric variance (iOS Safari/Android Chrome/WebViews all
// render the same font with slightly different hinting/kerning); this
// measures reality directly instead. Re-fits on resize/orientation change
// and whenever the text itself changes (e.g. a different percentile value).
// whiteSpace stays "nowrap" throughout -- this component's job is picking
// the largest size that avoids needing to wrap in the first place, not
// handling a wrap.
export function AutoFitText({ children, maxSize, minSize = 9, step = 0.5, style, ...props }) {
  const ref = useRef(null);
  const [fontSize, setFontSize] = useState(maxSize);

  useLayoutEffect(() => {
    const el = ref.current;
    const container = el?.parentElement;
    if (!el || !container) return;

    function fit() {
      let size = maxSize;
      el.style.fontSize = `${size}px`;
      while (size > minSize && el.scrollWidth > container.clientWidth) {
        size -= step;
        el.style.fontSize = `${size}px`;
      }
      setFontSize(size);
    }

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [children, maxSize, minSize, step]);

  return (
    <div ref={ref} style={{ ...style, fontSize, whiteSpace: "nowrap" }} {...props}>
      {children}
    </div>
  );
}
