/* Public, attribution-bearing exercise illustration lookup. No remote runtime requests. */
(function () {
  let entries = {};
  let credits = [];
  async function load() {
    try {
      const [manifest, creditData] = await Promise.all([
        fetch("/data/exercise-media.json?v=25", { cache: "force-cache" }).then((response) => response.json()),
        fetch("/data/media-credits.json?v=25", { cache: "force-cache" }).then((response) => response.json())
      ]);
      entries = manifest.entries || {};
      credits = creditData.credits || [];
    } catch { entries = {}; credits = []; }
  }
  window.WFMedia = { load, get: (id) => entries[id] || null, credits: () => credits };
}());
