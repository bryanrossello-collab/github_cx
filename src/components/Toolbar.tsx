import { Filter, RotateCcw, Search, SlidersHorizontal, ZoomIn, ZoomOut } from 'lucide-react';

import { categories, priorities, statuses, teams, timeframes } from '../data/roadmap';
import type { Filters } from '../types';

interface ToolbarProps {
  filters: Filters;
  zoom: number;
  onFilterChange: (filters: Filters) => void;
  onReset: () => void;
  onZoomChange: (zoom: number) => void;
}

export function Toolbar({ filters, zoom, onFilterChange, onReset, onZoomChange }: ToolbarProps) {
  const updateFilter = <Key extends keyof Filters>(key: Key, value: Filters[Key]) => {
    onFilterChange({ ...filters, [key]: value });
  };

  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/80 p-4 shadow-2xl shadow-slate-200/80 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70 dark:shadow-black/20">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-inner shadow-slate-100 focus-within:border-cyan-400 focus-within:ring-4 focus-within:ring-cyan-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:shadow-none dark:focus-within:ring-cyan-950">
            <Search className="h-4 w-4" aria-hidden="true" />
            <input
              value={filters.query}
              onChange={(event) => updateFilter('query', event.target.value)}
              className="w-full bg-transparent text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
              placeholder="Search initiatives, owners, milestones..."
              aria-label="Search roadmap items"
            />
          </div>

          <SelectFilter
            label="Status"
            value={filters.status}
            options={['All', ...statuses]}
            onChange={(value) => updateFilter('status', value as Filters['status'])}
          />
          <SelectFilter
            label="Team"
            value={filters.team}
            options={['All', ...teams]}
            onChange={(value) => updateFilter('team', value as Filters['team'])}
          />
          <SelectFilter
            label="Category"
            value={filters.category}
            options={['All', ...categories]}
            onChange={(value) => updateFilter('category', value as Filters['category'])}
          />
          <SelectFilter
            label="Timeframe"
            value={filters.timeframe}
            options={['All', ...timeframes]}
            onChange={(value) => updateFilter('timeframe', value as Filters['timeframe'])}
          />
          <SelectFilter
            label="Priority"
            value={filters.priority}
            options={['All', ...priorities]}
            onChange={(value) => updateFilter('priority', value as Filters['priority'])}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(0.85, Number((zoom - 0.05).toFixed(2))))}
              className="rounded-xl p-2 text-slate-600 transition hover:bg-white hover:text-cyan-700 focus:outline-none focus:ring-4 focus:ring-cyan-100 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:ring-cyan-950"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-12 text-center text-xs font-black text-slate-500">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(1.15, Number((zoom + 0.05).toFixed(2))))}
              className="rounded-xl p-2 text-slate-600 transition hover:bg-white hover:text-cyan-700 focus:outline-none focus:ring-4 focus:ring-cyan-100 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:ring-cyan-950"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:-translate-y-0.5 hover:border-cyan-200 hover:text-cyan-800 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-cyan-950"
          >
            <RotateCcw className="h-4 w-4" />
            Reset demo
          </button>
        </div>
      </div>
    </section>
  );
}

interface SelectFilterProps {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}

function SelectFilter({ label, value, options, onChange }: SelectFilterProps) {
  return (
    <label className="group relative">
      <span className="sr-only">{label}</span>
      <div className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-slate-400">
        {label === 'Status' ? <Filter className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
      </div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 appearance-none rounded-2xl border border-slate-200 bg-white py-2 pl-10 pr-9 text-sm font-bold text-slate-700 shadow-sm outline-none transition hover:border-cyan-200 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-cyan-950"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {label}: {option}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
        v
      </span>
    </label>
  );
}
