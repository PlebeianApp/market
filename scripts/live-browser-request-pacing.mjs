/** Browser prelude for the single-host five-member acceptance runner. */
export function liveBrowserRequestPacingPrelude(spacingMilliseconds) {
  if (!Number.isSafeInteger(spacingMilliseconds) || spacingMilliseconds < 1) {
    throw new Error("same-origin request spacing must be a positive safe integer");
  }
  return `(() => {
    const nativeSetInterval = globalThis.setInterval.bind(globalThis);
    const nativeClearInterval = globalThis.clearInterval.bind(globalThis);
    const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
    const nativeFetch = globalThis.fetch.bind(globalThis);
    let fetchQueue = Promise.resolve();
    let nextFetchAt = 0;
    globalThis.fetch = (...args) => {
      const input = args[0];
      const requestUrl = new URL(input instanceof Request ? input.url : String(input), globalThis.location.href);
      if (requestUrl.origin !== globalThis.location.origin) return nativeFetch(...args);
      const scheduled = fetchQueue.then(async () => {
        const remaining = Math.max(0, nextFetchAt - Date.now());
        if (remaining > 0) await new Promise((resolve) => nativeSetTimeout(resolve, remaining));
        nextFetchAt = Date.now() + ${spacingMilliseconds};
        return nativeFetch(...args);
      });
      fetchQueue = scheduled.then(() => undefined, () => undefined);
      return scheduled;
    };
    globalThis.setInterval = (callback, delay, ...args) => {
      if (delay === 1000) return 0;
      if (delay !== 4000) return nativeSetInterval(callback, delay, ...args);
      let ticks = 0; let handle = 0;
      handle = nativeSetInterval(() => {
        callback(...args);
        ticks += 1;
        if (ticks >= 2) nativeClearInterval(handle);
      }, delay);
      return handle;
    };
  })();`;
}
