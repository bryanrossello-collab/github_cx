import { motion } from 'framer-motion';
import { statuses, statusMeta } from '../data/roadmap';

export function Legend() {
  return (
    <motion.aside
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="rounded-[1.75rem] border border-white/70 bg-white/80 p-5 shadow-[0_18px_55px_rgba(20,35,60,0.10)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/70"
      aria-label="Roadmap status legend"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-950 dark:text-white">Status legend</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Color-coded delivery confidence</p>
        </div>
        <div className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-bold text-cyan-700 dark:bg-cyan-950 dark:text-cyan-200">
          Live
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statuses.map((status) => {
          const meta = statusMeta[status];

          return (
          <div
            key={status}
            className="flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
          >
            <span className={`h-2.5 w-2.5 rounded-full ${meta.dotClass}`} />
            {meta.label}
          </div>
          );
        })}
      </div>
    </motion.aside>
  );
}
