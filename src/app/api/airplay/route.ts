import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { signAirplayToken } from '@/lib/auth';

export const runtime = 'nodejs';

/** 登录用户换取 AirPlay 令牌：Apple TV 无会话 cookie，凭此令牌经代理拉取播放列表与分片 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  const { token, expiresAt } = signAirplayToken();
  return NextResponse.json(
    { token, expiresAt },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
