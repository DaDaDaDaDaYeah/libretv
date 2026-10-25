/**
 * AirPlay 支持（仅 Safari / WebKit）。
 *
 * hls.js 通过 MSE 喂视频，<video> 的 src 是 blob，Safari 无法把它投到 Apple TV。
 * 解法：再给 <video> 挂一个 <source>，指向原生可播的 m3u8 地址，Apple TV 自己去拉流。
 * Apple TV 没有会话 cookie，所以地址走 /api/proxy，并带短时效签名令牌（?ap=，见 auth.ts）；
 * 加 &ads=1 时服务端同样过滤广告分片，投屏不会比本地多出广告。
 */

const PROXY_PREFIX = '/api/proxy?url=';
const REFRESH_MARGIN_MS = 30 * 60 * 1000;

let cachedToken: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

/** 当前浏览器是否支持 AirPlay（WebKit 才有 WebKitPlaybackTargetAvailabilityEvent） */
export function isAirplayCapable(): boolean {
  return typeof window !== 'undefined' && 'WebKitPlaybackTargetAvailabilityEvent' in window;
}

async function getAirplayToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cachedToken.token;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/airplay', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = (await res.json()) as { token?: string; expiresAt?: number };
      if (!data.token || typeof data.expiresAt !== 'number') return null;
      cachedToken = { token: data.token, expiresAt: data.expiresAt };
      return data.token;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 还原上游原始 m3u8 地址：播放器可能已降级走 /api/proxy，投屏时统一重新包装 */
export function unwrapProxyUrl(mediaUrl: string): string {
  if (mediaUrl.startsWith(PROXY_PREFIX)) {
    const rest = mediaUrl.slice(PROXY_PREFIX.length).split('&')[0];
    try {
      return decodeURIComponent(rest);
    } catch {
      return rest;
    }
  }
  return mediaUrl;
}

/** 生成 Apple TV 可直接拉取的绝对地址 */
export function buildAirplayUrl(
  mediaUrl: string,
  token: string,
  stripAds: boolean,
  origin: string
): string {
  const upstream = unwrapProxyUrl(mediaUrl);
  const qs = `${PROXY_PREFIX}${encodeURIComponent(upstream)}&ap=${encodeURIComponent(token)}${
    stripAds ? '&ads=1' : ''
  }`;
  return new URL(qs, origin).href;
}

// 同一个 video 上并发切集时，只有最后一次调用生效
const generation = new WeakMap<HTMLVideoElement, number>();

/** 为 video 挂上 AirPlay 用的 <source>（非 WebKit 浏览器直接跳过，不请求令牌） */
export async function attachAirplaySource(
  video: HTMLVideoElement,
  mediaUrl: string,
  stripAds: boolean
): Promise<void> {
  // 始终允许远程播放；只有 WebKit 才需要后续的 <source> 兜底
  video.disableRemotePlayback = false;
  video.removeAttribute('disableRemotePlayback');
  if (!isAirplayCapable()) return;

  const gen = (generation.get(video) ?? 0) + 1;
  generation.set(video, gen);

  const token = await getAirplayToken();
  if (!token || generation.get(video) !== gen) return;

  const src = buildAirplayUrl(mediaUrl, token, stripAds, window.location.origin);
  video.querySelectorAll('source').forEach((s) => s.remove());
  const el = document.createElement('source');
  el.src = src;
  el.type = 'application/vnd.apple.mpegurl';
  video.appendChild(el);
}
