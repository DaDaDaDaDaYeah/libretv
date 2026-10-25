'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, upsertHistory, type HistoryEntry } from '@/lib/db';
import { buildWatchUrl, formatTime } from '@/lib/utils';
import { resolveSource, useAppStore } from '@/lib/store';
import { SmartImage } from './smart-image';

/**
 * 首页「继续观看」：取本机观看历史中最近的几部，点击直接续播。
 * 与历史抽屉共用 IndexedDB 数据，无新增存储；没有记录时整块不渲染。
 */

const ROW_LIMIT = 12;

/** 已看完（≥95%）的记录不再占位，除非后面还有下一集 */
function isWorthResuming(h: HistoryEntry): boolean {
  if (h.totalEpisodes > 1 && h.episodeIndex < h.totalEpisodes - 1) return true;
  if (h.duration <= 0) return true;
  return h.playbackPosition < h.duration * 0.95;
}

export function ContinueWatching() {
  const items = useLiveQuery(
    () => db.history.orderBy('timestamp').reverse().limit(ROW_LIMIT * 2).toArray(),
    []
  );
  const list = (items ?? []).filter(isWorthResuming).slice(0, ROW_LIMIT);
  if (list.length === 0) return null;

  return (
    <section aria-label="继续观看" className="mb-8">
      <h2 className="text-base font-semibold text-content mb-3">继续观看</h2>
      <ul className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x">
        {list.map((item) => (
          <ContinueCard key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

function ContinueCard({ item }: { item: HistoryEntry }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const [imgFailed, setImgFailed] = useState(false);
  const source = resolveSource({ customAPIs, envSources }, item.sourceKey);

  const hasPercent =
    item.playbackPosition > 10 && item.duration > 0 && item.playbackPosition < item.duration * 0.95;
  const percent = hasPercent ? Math.round((item.playbackPosition / item.duration) * 100) : 0;

  const href = buildWatchUrl({
    sourceKey: item.sourceKey,
    vodId: item.vodId,
    index: item.episodeIndex,
    title: item.title,
    sourceUrl: source?.url,
    detail: source?.detail,
  });

  return (
    <li className="shrink-0 w-32 snap-start">
      <Link
        href={href}
        onClick={() => {
          // 与历史抽屉一致：点击即刷新时间戳，保持「最近观看」排序
          upsertHistory({ ...item, timestamp: Date.now() }).catch(() => {});
        }}
        className="block group"
      >
        <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-chip">
          {item.pic && !imgFailed ? (
            <SmartImage
              url={item.pic}
              mode={imageProxyMode}
              customProxy={customImageProxy}
              alt=""
              className="w-full h-full object-cover"
              onExhausted={() => setImgFailed(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-faint text-xs px-2 text-center">
              {item.title}
            </div>
          )}
          {hasPercent && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
              <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>
        <div className="mt-1.5 text-sm font-medium text-content truncate group-hover:text-accent transition-colors">
          {item.title}
        </div>
        <div className="text-xs text-faint truncate">
          {item.totalEpisodes > 1 ? `第 ${item.episodeIndex + 1} 集` : '继续观看'}
          {hasPercent && ` · ${formatTime(item.playbackPosition)}`}
        </div>
      </Link>
    </li>
  );
}
