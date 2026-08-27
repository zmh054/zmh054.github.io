// ============================================================
// 云端计数器 - Cloudflare Worker 后端
// 功能：
//   1. GET  /api/value  -> 读取当前值（含"惰性清零"：跨天自动归零）
//   2. POST /api/value  -> 设置新值 { "value": 123 }
//   3. 每天北京时间 04:00（UTC 20:00）由 Cron 定时清零
// 数据存储在 Cloudflare KV（binding: MY_KV），键名 "variable"，
// 结构为 JSON 字符串：{ "value": 0, "date": "2026-08-27" }
// ============================================================

// 北京时间为 UTC+8 且无夏令时
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const KV_KEY = 'variable';

const CORS_HEADERS = {
  // 如需更严格，可改为 'https://yourname.github.io'
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 读取 / 写入变量
    if (url.pathname === '/api/value') {
      if (request.method === 'GET') {
        const record = await getCurrentValue(env);
        return json({ value: record.value, date: record.date }, 200, CORS_HEADERS);
      }

      if (request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: '请求体不是合法的 JSON' }, 400, CORS_HEADERS);
        }

        const value = Number(body.value);
        if (!Number.isFinite(value)) {
          return json({ error: 'value 必须是一个数字' }, 400, CORS_HEADERS);
        }

        const today = getBeijingDate();
        const record = { value, date: today };
        await env.MY_KV.put(KV_KEY, JSON.stringify(record));
        return json({ value, date: today }, 200, CORS_HEADERS);
      }
    }

    return json({ error: 'Not Found' }, 404, CORS_HEADERS);
  },

  // Cron 定时清零：每天北京时间 04:00（wrangler.toml 中配置 crons = ["0 20 * * *"]）
  async scheduled(event, env, ctx) {
    const today = getBeijingDate();
    await env.MY_KV.put(KV_KEY, JSON.stringify({ value: 0, date: today }));
    console.log(`[scheduled] 已清零，北京日期: ${today}`);
  },
};

// 读取当前值；若存储日期不是今天（北京时间），则视为跨天，自动清零
async function getCurrentValue(env) {
  const today = getBeijingDate();
  const raw = await env.MY_KV.get(KV_KEY);
  const record = raw ? JSON.parse(raw) : { value: 0, date: today };

  if (record.date !== today) {
    record.value = 0;
    record.date = today;
    await env.MY_KV.put(KV_KEY, JSON.stringify(record));
  }
  return record;
}

// 获取北京时区的日期字符串 YYYY-MM-DD
function getBeijingDate() {
  const now = new Date();
  const beijing = new Date(now.getTime() + BEIJING_OFFSET_MS);
  return beijing.toISOString().slice(0, 10);
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}
