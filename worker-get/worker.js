const BASES = [
  'https://cx.1189.dpdns.org/',
  'https://cx.zhaozg.dpdns.org/',
];

// 访问时间段控制（与 config.yaml access_time 保持同步）
const ALLOW_START = 6;   // 北京时间允许访问的开始时间
const ALLOW_END = 23;    // 北京时间允许访问的结束时间
const TZ_OFFSET = 8;     // UTC 偏移（北京时间 = +8）

export default {
  async fetch(request) {
    // 时间段检查
    const now = new Date();
    const local = new Date(now.getTime() + TZ_OFFSET * 3600000);
    const hour = local.getUTCHours();
    if (hour < ALLOW_START || hour >= ALLOW_END) {
      return new Response(
        `APK 暂时无法获取：当前不在服务时段（${ALLOW_START}:00 - ${ALLOW_END}:00 北京时间）`,
        { status: 503, headers: { 'Retry-After': String((ALLOW_START - hour + 24) % 24 * 3600) } }
      );
    }

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
