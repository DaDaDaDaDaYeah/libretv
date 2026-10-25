import { describe, expect, it } from 'vitest';
import { buildAirplayUrl, unwrapProxyUrl } from './airplay';

describe('unwrapProxyUrl', () => {
  it('还原被 /api/proxy 包装的上游地址', () => {
    const up = 'https://cdn.example.com/a b/index.m3u8?x=1&y=2';
    expect(unwrapProxyUrl(`/api/proxy?url=${encodeURIComponent(up)}`)).toBe(up);
  });
  it('直连地址原样返回', () => {
    expect(unwrapProxyUrl('https://cdn.example.com/index.m3u8')).toBe('https://cdn.example.com/index.m3u8');
  });
});

describe('buildAirplayUrl', () => {
  it('生成带令牌的绝对代理地址，可选广告过滤标记', () => {
    const url = new URL(buildAirplayUrl('https://cdn.example.com/i.m3u8?a=1&b=2', '123.abc', true, 'http://192.168.1.5:8080'));
    expect(url.origin).toBe('http://192.168.1.5:8080');
    expect(url.pathname).toBe('/api/proxy');
    expect(url.searchParams.get('url')).toBe('https://cdn.example.com/i.m3u8?a=1&b=2');
    expect(url.searchParams.get('ap')).toBe('123.abc');
    expect(url.searchParams.get('ads')).toBe('1');
    expect(new URL(buildAirplayUrl('https://x/i.m3u8', 't.s', false, 'http://h')).searchParams.has('ads')).toBe(false);
  });
});
