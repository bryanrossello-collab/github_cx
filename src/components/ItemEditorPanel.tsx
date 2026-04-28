import { AnimatePresence, motion } from 'framer-motion';
import { Calendar, Layers3, Save, Trash2, X } from 'lucide-react';
import type { FormEvent } from 'react';
import { categories, phases, priorities, statuses, teams, timeframes } from '../data/roadmap';
import type { Phase, Priority, RoadmapItem, Status, Team, Timeframe } from '../types';

interface ItemEditorPanelProps {
  item: RoadmapItem | null;
  onClose: () => void;
  onSave: (item: RoadmapItem) => void;
  onDelete: (id: string) => void;
}

export function ItemEditorPanel({ item, onClose, onSave, onDelete }: ItemEditorPanelProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!item) return;

    const form = new FormData(event.currentTarget);
    onSave({
      ...item,
      title: String(form.get('title') ?? '').trim(),
      owner: String(form.get('owner') ?? '').trim(),
      team: form.get('team') as Team,
      category: String(form.get('category') ?? ''),
      phase: form.get('phase') as Phase,
      status: form.get('status') as Status,
      priority: form.get('priority') as Priority,
      timeframe: form.get('timeframe') as Timeframe,
      startDate: String(form.get('startDate') ?? ''),
      endDate: String(form.get('endDate') ?? ''),
      milestone: String(form.get('milestone') ?? '').trim(),
      effort: Number(form.get('effort') ?? item.effort),
      impact: Number(form.get('impact') ?? item.impact),
      description: String(form.get('description') ?? '').trim(),
    });
  };

  return (
    <AnimatePresence>
      {item && (
        <>
          <motion.button
            type="button"
            aria-label="Close roadmap editor"
            onClick={onClose}
            className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm dark:bg-black/50 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-xl flex-col overflow-hidden border-l border-white/70 bg-white/92 shadow-[0_0_90px_rgba(15,23,42,0.22)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/92 sm:rounded-l-[2rem]"
            initial={{ x: '100%', opacity: 0.5 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 28 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-title"
          >
            <div className="relative overflow-hidden border-b border-slate-200/80 p-6 dark:border-white/10">
              <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(0,188,212,0.18),transparent_35%),linear-gradient(135deg,rgba(3,54,61,0.08),transparent)]" />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-cyan-700 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-200">
                    <Layers3 className="h-3.5 w-3.5" />
                    Roadmap detail
                  </span>
                  <h2 id="editor-title" className="mt-3 text-2xl font-black text-slate-950 dark:text-white">
                    Shape this initiative
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Update ownership, timing, priority, and narrative.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-2xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label="Close editor"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
                <Field label="Title">
                  <input name="title" defaultValue={item.title} required className={inputClass} />
                </Field>

                <Field label="Description">
                  <textarea name="description" defaultValue={item.description} rows={5} className={inputClass} />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Owner">
                    <input name="owner" defaultValue={item.owner} required className={inputClass} />
                  </Field>
                  <Field label="Team">
                    <select name="team" defaultValue={item.team} className={inputClass}>
                      {teams.map((team) => (
                        <option key={team}>{team}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Phase">
                    <select name="phase" defaultValue={item.phase} className={inputClass}>
                      {phases.map((phase) => (
                        <option key={phase}>{phase}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select name="status" defaultValue={item.status} className={inputClass}>
                      {statuses.map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Category">
                    <select name="category" defaultValue={item.category} className={inputClass}>
                      {categories.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Priority">
                    <select name="priority" defaultValue={item.priority} className={inputClass}>
                      {priorities.map((priority) => (
                        <option key={priority}>{priority}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Timeframe">
                    <select name="timeframe" defaultValue={item.timeframe} className={inputClass}>
                      {timeframes.map((timeframe) => (
                        <option key={timeframe}>{timeframe}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="Milestone">
                  <input name="milestone" defaultValue={item.milestone} className={inputClass} />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Start date">
                    <input name="startDate" type="date" defaultValue={item.startDate} className={inputClass} />
                  </Field>
                  <Field label="End date">
                    <input name="endDate" type="date" defaultValue={item.endDate} className={inputClass} />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <RangeField name="effort" label="Effort" defaultValue={item.effort} />
                  <RangeField name="impact" label="Impact" defaultValue={item.impact} />
                </div>

                <div className="rounded-3xl border border-cyan-200 bg-cyan-50/80 p-4 text-sm text-cyan-900 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-100">
                  <Calendar className="mb-2 h-5 w-5" />
                  Changes save locally in this browser and can be reordered directly from the canvas.
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 p-5 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700 transition hover:-translate-y-0.5 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 dark:border-white/10 dark:bg-white/10 dark:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#03363D] to-[#00a3a3] px-5 py-3 text-sm font-black text-white shadow-[0_18px_38px_rgba(3,54,61,0.25)] transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    <Save className="h-4 w-4" />
                    Save item
                  </button>
                </div>
              </div>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

const inputClass =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-200/50 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:ring-cyan-400/15';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
      {label}
      {children}
    </label>
  );
}

function RangeField({ name, label, defaultValue }: { name: string; label: string; defaultValue: number }) {
  return (
    <label className="rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
      <span className="flex items-center justify-between text-xs font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
        <span>{defaultValue}/10</span>
      </span>
      <input
        name={name}
        type="range"
        min="1"
        max="10"
        defaultValue={defaultValue}
        className="mt-4 w-full accent-cyan-500"
      />
    </label>
  );
}
