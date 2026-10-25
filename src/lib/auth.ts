import crypto from 'node:crypto';

/**
 * 会话鉴权：httpOnly cookie + HMAC 签名。
 *
 * 相比旧版的改进：
 * - 页面源码不再下发 sha256(password)，前端拿不到任何可重放的凭证；
 * - 兼容模式「哈希即凭证」被彻底移除；
 * - 登录接口只接受 POST body，不再把明文密码放 query。
 */

export const SESSION_COOKIE = 'ltv_session';
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 天

export function getPassword(): string {
  return process.env.PASSWORD || '';
}

export function isPasswordConfigured(): boolean {
  return getPassword().length > 0;
}

function getSecret(): string {
  if (process.env.PROXY_SECRET) return process.env.PROXY_SECRET;
  return crypto.createHash('sha256').update(getPassword() + ':libretv::session-salt').digest('hex');
}

function hmac(payload: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

/** 生成签名会话 token：`<expiresAtMs>.<hmac>` */
export function signSession(): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = String(expiresAt);
  return { token: `${payload}.${hmac(payload)}`, expiresAt };
}

/** 校验会话 token 的签名与有效期 */
export function verifySession(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const expiresAt = parseInt(payload, 10);
  if (!Number.isFinite(expiresAt)) return false;
  return Date.now() < expiresAt;
}

// —— AirPlay 播放令牌 ——
// Apple TV 自己去拉流，没有会话 cookie。登录用户可换取一枚短时效令牌，
// 附在代理地址（含 m3u8 重写后的分片）上放行，过期自动失效。

export const AIRPLAY_TTL_MS = 4 * 60 * 60 * 1000; // 4 小时

/** 生成 AirPlay 令牌：`<expiresAtMs>.<hmac>`（与会话令牌用不同的签名域，互不通用） */
export function signAirplayToken(now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + AIRPLAY_TTL_MS;
  const payload = `airplay:${expiresAt}`;
  return { token: `${expiresAt}.${hmac(payload)}`, expiresAt };
}

/** 校验 AirPlay 令牌的签名与有效期 */
export function verifyAirplayToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expiresAt = parseInt(token.slice(0, dot), 10);
  if (!Number.isFinite(expiresAt) || now >= expiresAt) return false;
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(hmac(`airplay:${expiresAt}`));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 恒定时间比较密码（比较 sha256 摘要避免长度泄漏） */
export function checkPassword(input: string): boolean {
  const password = getPassword();
  if (!password) return false;
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(password).digest();
  return crypto.timingSafeEqual(a, b);
}

/** 从请求 Cookie 中解析会话 */
export function sessionFromCookieHeader(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  const cookies = cookieHeader.split(';');
  for (const c of cookies) {
    const eq = c.indexOf('=');
    if (eq === -1) continue;
    const name = c.slice(0, eq).trim();
    if (name === SESSION_COOKIE) {
      return verifySession(decodeURIComponent(c.slice(eq + 1).trim()));
    }
  }
  return false;
}

// —— 登录速率限制（内存实现，单实例部署足够；多实例可换 Redis） ——

const attemptMap = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = attemptMap.get(ip);
  if (!entry || now > entry.resetAt) {
    attemptMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

export function clearRateLimit(ip: string): void {
  attemptMap.delete(ip);
}

// 定期清理过期限流记录，避免长期运行下 Map 膨胀
if (typeof setInterval === 'function') {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of attemptMap) {
      if (now > entry.resetAt) attemptMap.delete(ip);
    }
  }, 60 * 1000);
  // 不阻止 Node 进程退出
  if (typeof timer.unref === 'function') timer.unref();
}
