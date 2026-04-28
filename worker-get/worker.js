const BASES = [
  'https://cx.1189.dpdns.org/',
  'https://cx.zhaozg.dpdns.org/',
];

export default {
  async fetch(request) {
    for (const base of BASES) {
      try {
        const res = await fetch(base + 'version.json', { cf: { cacheEverything: false } });
        if (!res.ok) continue;
        const { apk_file } = await res.json();
        if (!apk_file) continue;
        return Response.redirect(base + apk_file, 302);
      } catch (_) {
        continue;
      }
    }
    return new Response('APK 暂时无法获取，请稍后重试', { status: 502 });
  },
};
