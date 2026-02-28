// Shim for react-dom in React Native
// Required because @clerk/clerk-react imports react-dom for web portals
// This is safe to stub in React Native as those features aren't used

export const createPortal = (children) => children;
export const flushSync = (fn) => fn();
export default {
  createPortal,
  flushSync,
};
