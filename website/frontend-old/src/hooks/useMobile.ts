import { useState, useEffect } from 'react';

// Detect mobile devices via user agent
const isMobileDevice = () => {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// Detect mobile viewport width (< 768px is Tailwind's md breakpoint)
const isMobileViewport = () => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
};

/**
 * Hook for detecting mobile devices and viewports
 * @returns Object with isMobile (user agent), isMobileViewport (screen width), and isSmallScreen (either)
 */
export function useMobile() {
  const [state, setState] = useState({
    isMobile: isMobileDevice(),
    isMobileViewport: isMobileViewport(),
  });

  useEffect(() => {
    const handleResize = () => {
      setState({
        isMobile: isMobileDevice(),
        isMobileViewport: isMobileViewport(),
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return {
    ...state,
    // True if either mobile device OR small viewport
    isSmallScreen: state.isMobile || state.isMobileViewport,
  };
}

export default useMobile;
