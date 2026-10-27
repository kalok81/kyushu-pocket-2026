// Offline: the site's own files are kept on the phone so the app opens without a network (in the mountains, on the
// underground). The trip data is not kept here: Firestore keeps its own offline copy of what was last loaded.
// - the page: from the network (a new version shows at once), the kept copy when offline or after 4 seconds;
// - files with ?v= (stamped by the build): kept copy first, as a new version has a new address; older ones are dropped;
// - other files of the site (vendor, icons): the kept copy at once, refreshed in the background.
// Other sites (Firebase, maps, weather) are not touched.
const CACHE = "pocket-travel-1";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add("./"))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function keep(req, res) {
  if (!res || !res.ok || res.type !== "basic") return res;
  const c = await caches.open(CACHE),
    url = new URL(req.url);
  if (url.searchParams.has("v"))
    for (const old of await c.keys()) {
      const o = new URL(old.url);
      if (o.pathname === url.pathname && o.search !== url.search) await c.delete(old);
    }
  await c.put(req, res.clone());
  return res;
}
function page(req) {
  const net = fetch(req).then((res) => keep(new Request("./"), res));
  const late = new Promise((ok) => setTimeout(ok, 4000)).then(() => caches.match("./"));
  return Promise.race([net.catch(() => caches.match("./")), late.then((hit) => hit || net)]).then((res) => res || net);
}

self.addEventListener("fetch", (e) => {
  const req = e.request,
    url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (req.mode === "navigate") return e.respondWith(page(req));
  if (url.searchParams.has("v")) return e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => keep(req, res))));
  const fresh = fetch(req).then((res) => keep(req, res));
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.match(req).then((hit) => hit || fresh));
});
