  // Offline: sw.js keeps the site's files on the phone so the app still opens without a network.
  // Registered here, as the page loads, not after signing in (the app starts only once Firebase is connected).
  if (location.protocol === "https:" || location.hostname === "localhost") navigator.serviceWorker?.register("sw.js").catch(() => {});
