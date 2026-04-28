import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import { CalendarDays, Flag, GripVertical, Sparkles, UserRound } from 'lucide-react';
import { clsx } from 'clsx';
import type { RoadmapItem } from '../types';
import { priorityMeta, statusMeta, teamMeta } from '../data/roadmap';
import { formatDateRange } from '../utils/roadmap';

interface RoadmapCardProps {
  item: RoadmapItem;
  onSelect: (item: RoadmapItem) => void;
}

export function RoadmapCard({ item, onSelect }: RoadmapCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, data: { phase: item.phase } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const status = statusMeta[item.status];
  const priority = priorityMeta[item.priority];

  return (
    <motion.article
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: isDragging ? 1.04 : 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.94 }}
      whileHover={{ y: -4 }}
      className={clsx(
        'group relative overflow-hidden rounded-3xl border border-white/70 bg-white/90 p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)] outline-none backdrop-blur-xl transition dark:border-white/10 dark:bg-slate-900/86 dark:shadow-black/20',
        isDragging && 'z-50 rotate-1 shadow-[0_28px_70px_rgba(12,27,54,0.24)]',
      )}
    >
      <div
        className={clsx(
          'absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r',
          priority.accent,
        )}
      />
      <div className="absolute -right-10 -top-10 h-24 w-24 rounded-full bg-cyan-200/20 blur-2xl transition group-hover:bg-cyan-300/30 dark:bg-cyan-400/10" />
      <div
        aria-hidden="true"
        className={clsx(
          'absolute bottom-0 left-0 h-full w-1 bg-gradient-to-b opacity-80',
          priority.accent,
        )}
      />

      <div className="relative flex items-start gap-3">
        <button
          type="button"
          aria-label={`Drag ${item.title}`}
          className="mt-1 cursor-grab rounded-xl p-1.5 text-slate-400 outline-none transition hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-cyan-400 active:cursor-grabbing dark:hover:bg-white/10 dark:hover:text-slate-200"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => onSelect(item)}
          className="min-w-0 flex-1 text-left outline-none focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em]',
                status.badgeClass,
              )}
            >
              <span className={clsx('h-1.5 w-1.5 rounded-full', status.dotClass)} />
              {status.label}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:bg-white/10 dark:text-slate-300">
              {item.timeframe}
            </span>
          </div>

          <h3 className="text-base font-black leading-tight text-slate-950 dark:text-white">
            {item.title}
          </h3>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {item.description}
          </p>

          <div className="mt-4 grid gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-2">
              <UserRound className={clsx('h-3.5 w-3.5', teamMeta[item.team].text)} />
              {item.owner} · {item.team}
            </span>
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="h-3.5 w-3.5 text-teal-500" />
              {formatDateRange(item.startDate, item.endDate)}
            </span>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="rounded-2xl bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">
              {item.category}
            </span>
            <span className={clsx('inline-flex items-center gap-1.5 rounded-2xl border px-3 py-1.5 text-xs font-black', priority.className)}>
              <Sparkles className="h-3.5 w-3.5" />
              {priority.label}
            </span>
          </div>

          <div className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-50 to-teal-50 px-3 py-1.5 text-xs font-bold text-slate-600 dark:from-cyan-950/40 dark:to-teal-950/40 dark:text-slate-300">
            <Flag className="h-3.5 w-3.5 text-cyan-500" />
            {item.milestone}
          </div>
        </button>
      </div>
    </motion.article>
  );
}
