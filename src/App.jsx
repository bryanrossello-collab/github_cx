import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Layers,
  ShieldCheck,
  Skull,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';

const segments = [
  {
    id: 'healthy',
    title: 'Healthy + Expansion',
    definition: 'Strong product value, good relationship, credible upsell potential.',
    owner: 'Sales',
    priority: 'Protect and Expand',
    color: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    icon: TrendingUp,
    tagColor: 'bg-emerald-100 text-emerald-800',
    accentColor: 'bg-emerald-100',
    signals: ['Health Score > 80', 'High Feature Adoption', 'NPS 9-10'],
  },
  {
    id: 'stable',
    title: 'Stable Renewal',
    definition: 'Low risk, no major issues, likely to renew on time with standard process.',
    owner: 'Renewals',
    priority: 'Secure Efficiently',
    color: 'bg-blue-50 border-blue-200 text-blue-700',
    icon: ShieldCheck,
    tagColor: 'bg-blue-100 text-blue-800',
    accentColor: 'bg-blue-100',
    signals: ['Health Score 60-80', 'Steady Usage', 'Low Support Volume'],
  },
  {
    id: 'contraction',
    title: 'At-Risk Contraction',
    definition: 'Usage/value concerns, budget pressure, or scope reduction likely.',
    owner: 'Renewals',
    priority: 'Reduce Contraction',
    color: 'bg-amber-50 border-amber-200 text-amber-700',
    icon: AlertTriangle,
    tagColor: 'bg-amber-100 text-amber-800',
    accentColor: 'bg-amber-100',
    signals: ['Usage < 60%', 'Budget Cautious', 'Downsell Mentioned'],
  },
  {
    id: 'churn',
    title: 'Churn Risk',
    definition: 'High likelihood of non-renewal or severe seat/license reduction.',
    owner: 'Renewals + Exec',
    priority: 'Save if Possible',
    color: 'bg-rose-50 border-rose-200 text-rose-700',
    icon: Skull,
    tagColor: 'bg-rose-100 text-rose-800',
    accentColor: 'bg-rose-100',
    signals: ['Zero Usage (30d)', 'Executive Ghosting', 'Bad NPS Score'],
  },
  {
    id: 'strategic',
    title: 'Strategic Expand Save',
    definition: 'Big account where renewal is vulnerable but expansion may unlock retention.',
    owner: 'Joint Lead',
    priority: 'Exec-Managed',
    color: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    icon: Zap,
    tagColor: 'bg-indigo-100 text-indigo-800',
    accentColor: 'bg-indigo-100',
    signals: ['Top 5% ARR', 'Poor Sentiment', 'Expansion Opportunity'],
  },
];

const viewButtonClassName = (isActive) =>
  `px-4 py-2 rounded-lg text-sm font-bold transition-all ${
    isActive ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-800'
  }`;

const AccountSegmentationModel = () => {
  const [viewMode, setViewMode] = useState('segments');

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans text-slate-900 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="text-center md:text-left">
            <div className="mb-4 inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-bold uppercase tracking-widest text-blue-600">
              Leadership Framework
            </div>
            <h1 className="mb-2 text-3xl font-extrabold tracking-tight md:text-4xl">
              Operational Segmentation
            </h1>
            <p className="max-w-xl text-lg text-slate-600">
              Mapping data signals to commercial ownership and strategic priorities.
            </p>
          </div>

          <div className="flex self-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm md:self-end">
            <button
              type="button"
              onClick={() => setViewMode('segments')}
              className={viewButtonClassName(viewMode === 'segments')}
            >
              Segment View
            </button>
            <button
              type="button"
              onClick={() => setViewMode('crosswalk')}
              className={viewButtonClassName(viewMode === 'crosswalk')}
            >
              Crosswalk Logic
            </button>
          </div>
        </header>

        {viewMode === 'segments' ? (
          <div className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {segments.map((segment) => {
              const SegmentIcon = segment.icon;

              return (
                <div
                  key={segment.id}
                  className={`relative overflow-hidden rounded-2xl border-2 p-6 shadow-sm transition-all duration-300 ${segment.color}`}
                >
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div className={`rounded-lg p-2 ${segment.tagColor}`}>
                      <SegmentIcon className="h-6 w-6" />
                    </div>
                    <span
                      className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-wider ${segment.tagColor}`}
                    >
                      {segment.priority}
                    </span>
                  </div>

                  <h3 className="mb-2 text-xl font-bold leading-tight">{segment.title}</h3>

                  <p className="mb-6 text-sm leading-relaxed opacity-90">{segment.definition}</p>

                  <div className="flex items-center justify-between border-t border-black/5 pt-4">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 opacity-60" />
                      <span className="text-xs font-semibold">{segment.owner}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mb-12 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
            <div className="bg-slate-900 px-8 py-6 text-white">
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <Layers className="h-5 w-5 text-blue-400" />
                Data-to-Segment Crosswalk
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-8 py-4 text-xs font-bold uppercase text-slate-500">
                      Target Segment
                    </th>
                    <th className="px-8 py-4 text-xs font-bold uppercase text-slate-500">
                      Data Signals (Input)
                    </th>
                    <th className="px-8 py-4 text-xs font-bold uppercase text-slate-500">
                      Strategic Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {segments.map((segment) => (
                    <tr key={segment.id} className="hover:bg-slate-50/50">
                      <td className="px-8 py-6 align-top">
                        <div className="mb-1 flex items-center gap-3">
                          <div className={`h-6 w-2 rounded-full ${segment.accentColor}`} />
                          <span className="font-bold text-slate-800">{segment.title}</span>
                        </div>
                        <p className="text-xs text-slate-500">{segment.owner}</p>
                      </td>
                      <td className="px-8 py-6">
                        <div className="space-y-2">
                          {segment.signals.map((signal) => (
                            <div
                              key={`${segment.id}-${signal}`}
                              className="flex items-center gap-2 text-sm text-slate-600"
                            >
                              <CheckCircle2 className="h-3 w-3 text-slate-400" />
                              {signal}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-8 py-6 align-top">
                        <span
                          className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${segment.tagColor}`}
                        >
                          {segment.priority}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-8">
          <div className="flex flex-col items-center gap-8 md:flex-row">
            <div className="flex-1">
              <h3 className="mb-2 flex items-center gap-2 text-xl font-bold">
                <HelpCircle className="h-5 w-5 text-blue-500" />
                How to use this Crosswalk
              </h3>
              <p className="text-sm leading-relaxed text-slate-600">
                Filter your CRM by the "Data Signals" column. Any account that meets 2 or more
                criteria should be automatically moved into that Segment. This removes subjectivity
                and ensures Sales and CS are working from a single source of truth.
              </p>
            </div>
            <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-6 md:w-auto">
              <div className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-400">
                Ownership Guide
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm font-semibold">
                  <div className="h-3 w-3 rounded bg-emerald-500" /> Sales: Growth
                </div>
                <div className="flex items-center gap-3 text-sm font-semibold">
                  <div className="h-3 w-3 rounded bg-blue-500" /> Renewals: Continuity
                </div>
                <div className="flex items-center gap-3 text-sm font-semibold">
                  <div className="h-3 w-3 rounded bg-rose-500" /> Leadership: Save
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountSegmentationModel;
