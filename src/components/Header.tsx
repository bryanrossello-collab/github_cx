import { motion } from 'framer-motion';
import {
  BarChart3,
  Moon,
  PanelTop,
  Search,
  Sparkles,
  Sun,
} from 'lucide-react';
import type { ViewMode } from '../types';

interface HeaderProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  visibleCount: number;
  totalCount: number;
  viewMode: ViewMode;
  onViewModeChange: (viewMode: ViewMode) => void;
}

export function Header({
  darkMode,
  onToggleDarkMode,
  searchTerm,
  onSearchChange,
  visibleCount,
  totalCount,
  viewMode,
  onViewModeChange,
}: HeaderProps) {
  return (
    <header className="relative overflow-hidden border-b border-white/60 bg-white/80 px-4 py-5 shadow-[0_18px_80px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/70 sm:px-6 lg:px-8">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(0,188,212,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(50,67,255,0.12),transparent_32%)]" />
      <div className="mx-auto flex max-w-[1800px] flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, rotate: -6 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            className="flex h-14 w-14 items-center justify-center rounded-3xl bg-[#03363d] text-white shadow-2xl shadow-cyan-900/20 dark:bg-cyan-300 dark:text-slate-950"
          >
            <PanelTop size={28} strokeWidth={1.7} />
          </motion.div>

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-200">
                <Sparkles size={13} />
                Zendesk-inspired
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500 dark:bg-white/10 dark:text-slate-300">
                {visibleCount} of {totalCount} initiatives visible
              </span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-[#03363d] dark:text-white sm:text-4xl">
              Enterprise Product Roadmap
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Plan, prioritize, and orchestrate cross-functional product work
              across discovery, delivery, and launch.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="group flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white/85 px-4 py-3 shadow-sm transition focus-within:border-cyan-400 focus-within:ring-4 focus-within:ring-cyan-200/60 dark:border-white/10 dark:bg-white/10 dark:focus-within:ring-cyan-400/15 md:min-w-80">
            <Search
              size={18}
              className="text-slate-400 transition group-focus-within:text-cyan-500"
            />
            <span className="sr-only">Search roadmap items</span>
            <input
              value={searchTerm}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search initiatives, owners, milestones..."
              className="w-full bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400 dark:text-white"
            />
          </label>

          <button
            type="button"
            onClick={onToggleDarkMode}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-cyan-200 dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:focus:ring-cyan-400/20"
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            {darkMode ? 'Light' : 'Dark'}
          </button>

          <div className="grid grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm dark:border-white/10 dark:bg-white/10">
            {(['Swimlanes', 'Timeline'] satisfies ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onViewModeChange(mode)}
                aria-pressed={viewMode === mode}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-black capitalize transition focus:outline-none focus:ring-2 focus:ring-cyan-300 ${
                  viewMode === mode
                    ? 'bg-[#03363d] text-white shadow-lg dark:bg-cyan-300 dark:text-slate-950'
                    : 'text-slate-500 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/10'
                }`}
              >
                <BarChart3 size={16} />
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
