const BASES = [
  'https://cx.1189.dpdns.org/',
  'https://cx.zhaozg.dpdns.org/',
];

// 访问时间段/星期控制（与 config.yaml access_time 保持同步）
const ALLOW_START = 6;   // 北京时间允许访问的开始时间
const ALLOW_END = 23;    // 北京时间允许访问的结束时间
const TZ_OFFSET = 8;     // UTC 偏移（北京时间 = +8）
// 允许访问的星期（0=周日,1=周一...6=周六），注释掉或设为 null 表示每天均可访问
// const ALLOW_DAYS = [1, 2, 3, 4, 5];  // 例如仅工作日
const ALLOW_DAYS = null;

export default {
  async fetch(request) {
    const now = new Date();
    const local = new Date(now.getTime() + TZ_OFFSET * 3600000);

    // 时间段检查
    const hour = local.getUTCHours();
    if (hour < ALLOW_START || hour >= ALLOW_END) {
      return new Response(
        `APK 暂时无法获取：当前不在服务时段（${ALLOW_START}:00 - ${ALLOW_END}:00 北京时间）`,
        { status: 503, headers: { 'Retry-After': String((ALLOW_START - hour + 24) % 24 * 3600) } }
      );
    }

    // 星期检查
    if (ALLOW_DAYS && ALLOW_DAYS.length > 0) {
      const day = local.getUTCDay();
      if (!ALLOW_DAYS.includes(day)) {
        const names = ['周日','周一','周二','周三','周四','周五','周六'];
        return new Response(
          `APK 暂时无法获取：今日（${names[day]}）不在允许访问日（${ALLOW_DAYS.map(d => names[d]).join('、')}）`,
          { status: 503 }
        );
      }
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
