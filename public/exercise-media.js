/* Public, attribution-bearing exercise illustration lookup. No remote runtime requests. */
(function () {
  let entries = {};
  let credits = [];
  let videos = {};
  async function load() {
    try {
      const [manifest, creditData, videoData] = await Promise.all([
        fetch("/data/exercise-media.json?v=25", { cache: "force-cache" }).then((response) => response.json()),
        fetch("/data/media-credits.json?v=25", { cache: "force-cache" }).then((response) => response.json()),
        fetch("/data/exercise-videos.json?v=26", { cache: "force-cache" }).then((response) => response.json()).catch(() => ({ entries: {} }))
      ]);
      entries = manifest.entries || {};
      credits = creditData.credits || [];
      videos = videoData.entries || {};
    } catch { entries = {}; credits = []; videos = {}; }
  }
  window.WFMedia = { load, get: (id) => entries[id] || null, video: (id) => videos[id] || null, credits: () => credits };
}());
