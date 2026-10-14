// React's server-only `cache()` exists in the React build Next.js uses on the
// server, but not in the plain react@18 package Node loads in tests. For app
// modules under test, `react` resolves here: everything from React, plus a
// pass-through cache() (no per-request memoisation needed in tests).
import React from 'react';

export * from 'react';
export default React;
export const cache = React.cache || ((fn) => fn);
