import * as React from "react";

const MOBILE_BREAKPOINT = 768;
// v2 live-scoring shell requires the standard iPad-landscape viewport. The
// 10.2" iPad (the most common school-owned model) is 1080 CSS px wide in
// landscape; 10.9"/Pro models are 1180+. Threshold sits at 1080 so the
// 10.2" lands on v2. Sub-1080 (phones, iPad Mini, portrait) falls back
// to the v1 bottom-bar shell while v2 is mid-build.
const V2_LIVE_SCORING_BREAKPOINT = 1080;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * Returns `true` / `false` after the matchMedia query resolves on the
 * client; `undefined` during SSR and the first client render. Callers
 * should render a neutral placeholder while undefined to avoid a flash
 * of v1 → v2 on iPad-landscape viewports.
 */
export function useIsV2LiveScoringViewport(): boolean | undefined {
  const [isWide, setIsWide] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${V2_LIVE_SCORING_BREAKPOINT}px)`);
    const onChange = () => setIsWide(mql.matches);
    mql.addEventListener("change", onChange);
    setIsWide(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isWide;
}
