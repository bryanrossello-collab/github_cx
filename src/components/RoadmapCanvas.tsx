import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { AnimatePresence, motion } from 'framer-motion';
import { Layers3, Plus, Radar } from 'lucide-react';
import { clsx } from 'clsx';
import type { Phase, RoadmapItem, ViewMode } from '../types';
import { phaseMeta, phases } from '../data/roadmap';
import { RoadmapCard } from './RoadmapCard';

function PhaseDropZone({
  phase,
  children,
}: {
  phase: Phase;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `phase-${phase}`,
    data: { phase },
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'grid gap-3 rounded-3xl transition',
        isOver && 'bg-cyan-100/60 p-2 ring-2 ring-cyan-300 dark:bg-cyan-400/10',
      )}
    >
      {children}
    </div>
  );
}

interface RoadmapCanvasProps {
  items: RoadmapItem[];
  zoom: number;
  viewMode: ViewMode;
  onZoomChange: (zoom: number) => void;
  onAddItem: (phase?: Phase) => void;
  onSelectItem: (item: RoadmapItem) => void;
  onMoveItem: (activeId: string, overId: string, overPhase?: Phase) => void;
}

export function RoadmapCanvas({
  items,
  zoom,
  viewMode,
  onZoomChange,
  onAddItem,
  onSelectItem,
  onMoveItem,
}: RoadmapCanvasProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const overPhase =
      (over.data.current?.phase as Phase | undefined) ??
      (overId.startsWith('phase-') ? (overId.replace('phase-', '') as Phase) : undefined);

    onMoveItem(activeId, overId, overPhase);
  };

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/74 p-4 shadow-[0_30px_90px_rgba(12,27,54,0.12)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/50 dark:shadow-black/30 lg:p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,188,212,0.16),transparent_34%),radial-gradient(circle_at_80%_10%,rgba(84,60,255,0.12),transparent_28%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.045)_1px,transparent_1px)] bg-[size:44px_44px] opacity-60 dark:bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)]" />

      <div className="relative mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-cyan-700 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-200">
            <Radar className="h-3.5 w-3.5" />
            Live roadmap canvas
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
            Enterprise CX roadmap
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Drag cards across phases, open detailed planning notes, and keep every milestone visible at a glance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-2 text-sm font-bold text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
            Zoom
            <input
              aria-label="Canvas zoom"
              type="range"
              min="85"
              max="115"
              value={zoom}
              onChange={(event) => onZoomChange(Number(event.target.value))}
              className="h-2 w-28 accent-cyan-500"
            />
            <span className="w-10 text-right text-xs">{zoom}%</span>
          </label>
          <button
            type="button"
            onClick={() => onAddItem()}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#03363D] to-[#007a7a] px-4 py-2.5 text-sm font-black text-white shadow-[0_18px_34px_rgba(3,54,61,0.24)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_44px_rgba(3,54,61,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <Plus className="h-4 w-4" />
            Add item
          </button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <motion.div
          className="relative grid min-w-[980px] gap-4 overflow-x-auto pb-2 lg:grid-cols-5"
          animate={{ scale: zoom / 100 }}
          style={{ transformOrigin: 'top left' }}
          transition={{ type: 'spring', stiffness: 180, damping: 24 }}
        >
          {phases.map((phase, index) => {
            const phaseItems = items
              .filter((item) => item.phase === phase)
              .sort((a, b) => a.order - b.order);
            const meta = phaseMeta[phase];
            const PhaseIcon = meta.icon;
            return (
              <motion.div
                key={phase}
                data-phase={phase}
                id={`phase-${phase}`}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="min-h-[640px] rounded-[1.75rem] border border-white/70 bg-slate-50/76 p-3 shadow-inner backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.045]"
              >
                <div className="mb-3 flex items-center justify-between gap-3 rounded-3xl bg-white/80 p-3 shadow-sm dark:bg-slate-950/70">
                  <div className="flex items-center gap-3">
                    <span className={clsx('grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg', meta.gradient)}>
                      <PhaseIcon className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-black text-slate-950 dark:text-white">{phase}</h3>
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {viewMode === 'Timeline' ? meta.hint : `${phaseItems.length} ${phaseItems.length === 1 ? 'item' : 'items'}`}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAddItem(phase)}
                    className="rounded-2xl p-2 text-slate-400 transition hover:bg-cyan-50 hover:text-cyan-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 dark:hover:bg-cyan-400/10 dark:hover:text-cyan-200"
                    aria-label={`Add item to ${phase}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                <SortableContext items={phaseItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                  <PhaseDropZone phase={phase}>
                    <AnimatePresence initial={false}>
                      {phaseItems.map((item) => (
                        <RoadmapCard key={item.id} item={item} onSelect={onSelectItem} />
                      ))}
                    </AnimatePresence>
                  </PhaseDropZone>
                </SortableContext>

                {phaseItems.length === 0 && (
                  <motion.button
                    type="button"
                    onClick={() => onAddItem(phase)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-3 flex min-h-48 w-full flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/50 p-5 text-center text-slate-500 transition hover:border-cyan-300 hover:bg-cyan-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 dark:border-white/15 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-cyan-400/10"
                  >
                    <Layers3 className="mb-3 h-7 w-7 text-cyan-500" />
                    <span className="font-black text-slate-700 dark:text-slate-100">No items yet</span>
                    <span className="mt-1 text-sm">Add a milestone to start shaping this phase.</span>
                  </motion.button>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      </DndContext>
    </section>
  );
}
