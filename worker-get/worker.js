const FALLBACK_BASES = [
  'https://cx.1189.dpdns.org/',
  'https://cx.zhaozg.dpdns.org/',
  'https://cx.07170501.xyz/',
  'https://cx.11891189.xyz/'
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // 动态构造 base URL：取 origin + 第一段路径
    // 如 aa.bb.com/cx/xxx → https://aa.bb.com/cx/
    const seg = url.pathname.split('/').filter(Boolean)[0] || '';
    // 没有路径段（根域名部署），保持原状
    const allBases = seg ? [url.origin + '/' + seg + '/', ...FALLBACK_BASES] : FALLBACK_BASES;

    for (const base of allBases) {
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
