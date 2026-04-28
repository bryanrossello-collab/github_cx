import { FlaskConical, Gem, Rocket, ShieldCheck, Wrench } from 'lucide-react';
import type {
  ComponentType,
  SVGProps,
} from 'react';
import type { Phase, PhaseMeta, Priority, RoadmapItem, Status, StatusMeta, Team, Timeframe } from '../types';

export const phases: Phase[] = ['Discovery', 'Design', 'Development', 'Testing', 'Launch'];

export const statuses: Status[] = ['Planned', 'On track', 'At risk', 'Blocked', 'Complete'];
export const statusOptions = statuses;

export const priorities: Priority[] = ['Low', 'Medium', 'High', 'Critical'];

export const timeframes: Timeframe[] = ['Q1', 'Q2', 'Q3', 'Q4'];
export const quarters = timeframes;

export const categories = ['Experience', 'Platform', 'AI & Automation', 'Insights'] as const;

export const teams: Team[] = ['CX Platform', 'AI Assist', 'Messaging', 'Analytics', 'Admin'];

export const statusMeta: Record<Status, StatusMeta> = {
  Planned: {
    label: 'Planned',
    dotClass: 'bg-slate-400',
    badgeClass:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
    glowClass: 'shadow-slate-500/20',
  },
  'On track': {
    label: 'On track',
    dotClass: 'bg-cyan-400',
    badgeClass:
      'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-700/70 dark:bg-cyan-400/10 dark:text-cyan-200',
    glowClass: 'shadow-cyan-500/20',
  },
  'At risk': {
    label: 'At risk',
    dotClass: 'bg-amber-400',
    badgeClass:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/70 dark:bg-amber-400/10 dark:text-amber-200',
    glowClass: 'shadow-amber-500/20',
  },
  Blocked: {
    label: 'Blocked',
    dotClass: 'bg-rose-400',
    badgeClass:
      'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-700/70 dark:bg-rose-400/10 dark:text-rose-200',
    glowClass: 'shadow-rose-500/20',
  },
  Complete: {
    label: 'Complete',
    dotClass: 'bg-emerald-400',
    badgeClass:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/70 dark:bg-emerald-400/10 dark:text-emerald-200',
    glowClass: 'shadow-emerald-500/20',
  },
};

export const priorityMeta: Record<Priority, { label: string; className: string; accent: string }> = {
  Low: {
    label: 'Low',
    className:
      'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-slate-300',
    accent: 'from-slate-300 via-slate-200 to-slate-100',
  },
  Medium: {
    label: 'Medium',
    className:
      'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-700/60 dark:bg-sky-400/10 dark:text-sky-200',
    accent: 'from-sky-400 via-cyan-300 to-teal-300',
  },
  High: {
    label: 'High',
    className:
      'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-700/60 dark:bg-violet-400/10 dark:text-violet-200',
    accent: 'from-violet-500 via-cyan-400 to-teal-300',
  },
  Critical: {
    label: 'Critical',
    className:
      'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-700/60 dark:bg-rose-400/10 dark:text-rose-200',
    accent: 'from-rose-500 via-orange-400 to-amber-300',
  },
};

export const phaseMeta: Record<Phase, PhaseMeta> = {
  Discovery: {
    icon: FlaskConical as ComponentType<SVGProps<SVGSVGElement>>,
    gradient: 'from-cyan-400 to-teal-500',
    hint: 'Signals, research, hypotheses',
  },
  Design: {
    icon: Gem as ComponentType<SVGProps<SVGSVGElement>>,
    gradient: 'from-blue-500 to-violet-500',
    hint: 'UX, prototypes, validation',
  },
  Development: {
    icon: Wrench as ComponentType<SVGProps<SVGSVGElement>>,
    gradient: 'from-[#03363D] to-[#17494D]',
    hint: 'Build, integrate, iterate',
  },
  Testing: {
    icon: ShieldCheck as ComponentType<SVGProps<SVGSVGElement>>,
    gradient: 'from-amber-400 to-orange-500',
    hint: 'QA, UAT, readiness',
  },
  Launch: {
    icon: Rocket as ComponentType<SVGProps<SVGSVGElement>>,
    gradient: 'from-emerald-400 to-teal-500',
    hint: 'Rollout, enablement, adoption',
  },
};

export const teamMeta: Record<Team, { color: string; initials: string; text: string }> = {
  'CX Platform': { color: 'bg-[#03363D]', initials: 'CX', text: 'text-[#03363D] dark:text-cyan-200' },
  'AI Assist': { color: 'bg-cyan-500', initials: 'AI', text: 'text-cyan-500' },
  Messaging: { color: 'bg-blue-500', initials: 'MS', text: 'text-blue-500' },
  Analytics: { color: 'bg-violet-500', initials: 'AN', text: 'text-violet-500' },
  Admin: { color: 'bg-teal-500', initials: 'AD', text: 'text-teal-500' },
};

export const sampleRoadmapItems: RoadmapItem[] = [
  {
    id: 'item-1',
    title: 'AI-powered ticket triage',
    owner: 'Maya Chen',
    team: 'AI Assist',
    category: 'AI & Automation',
    phase: 'Discovery',
    status: 'On track',
    priority: 'High',
    startDate: '2026-04-08',
    endDate: '2026-05-03',
    milestone: 'Intent model validation',
    effort: 5,
    impact: 9,
    order: 0,
    timeframe: 'Q2',
    description:
      'Evaluate intent detection, confidence thresholds, and admin controls for automated support ticket routing.',
  },
  {
    id: 'item-2',
    title: 'Unified customer timeline',
    owner: 'Jordan Miles',
    team: 'CX Platform',
    category: 'Experience',
    phase: 'Design',
    status: 'On track',
    priority: 'High',
    startDate: '2026-05-01',
    endDate: '2026-06-10',
    milestone: 'Executive prototype review',
    effort: 7,
    impact: 10,
    order: 0,
    timeframe: 'Q2',
    description:
      'Create a single, contextual event stream across tickets, chats, email, calls, and product telemetry.',
  },
  {
    id: 'item-3',
    title: 'Realtime SLA health cockpit',
    owner: 'Priya Shah',
    team: 'Analytics',
    category: 'Insights',
    phase: 'Development',
    status: 'On track',
    priority: 'Medium',
    startDate: '2026-04-22',
    endDate: '2026-06-02',
    milestone: 'Live forecasting beta',
    effort: 6,
    impact: 8,
    order: 0,
    timeframe: 'Q2',
    description:
      'Deliver live SLA forecasting, breach risk indicators, and manager-level drilldowns for enterprise support teams.',
  },
  {
    id: 'item-4',
    title: 'Omnichannel composer refresh',
    owner: 'Ari Bennett',
    team: 'Messaging',
    category: 'Experience',
    phase: 'Development',
    status: 'Blocked',
    priority: 'Critical',
    startDate: '2026-04-29',
    endDate: '2026-06-14',
    milestone: 'Attachment security unblock',
    effort: 8,
    impact: 9,
    order: 1,
    timeframe: 'Q2',
    description:
      'Modernize the agent composer with snippets, tone assist, rich attachments, and channel-aware previews.',
  },
  {
    id: 'item-5',
    title: 'Enterprise admin spaces',
    owner: 'Sam Rivera',
    team: 'Admin',
    category: 'Platform',
    phase: 'Testing',
    status: 'At risk',
    priority: 'Medium',
    startDate: '2026-05-12',
    endDate: '2026-06-26',
    milestone: 'Regulated customer UAT',
    effort: 5,
    impact: 7,
    order: 0,
    timeframe: 'Q2',
    description:
      'Validate role-scoped workspaces for regional support organizations and complex compliance boundaries.',
  },
  {
    id: 'item-6',
    title: 'Marketplace connector studio',
    owner: 'Nora Ellis',
    team: 'CX Platform',
    category: 'Platform',
    phase: 'Launch',
    status: 'Complete',
    priority: 'Low',
    startDate: '2026-03-17',
    endDate: '2026-04-30',
    milestone: 'Partner launch kit',
    effort: 4,
    impact: 6,
    order: 0,
    timeframe: 'Q2',
    description:
      'Ship self-serve connector templates, OAuth testing, deployment checks, and partner publishing flows.',
  },
  {
    id: 'item-7',
    title: 'Conversation quality insights',
    owner: 'Theo Martin',
    team: 'Analytics',
    category: 'Insights',
    phase: 'Design',
    status: 'At risk',
    priority: 'Medium',
    startDate: '2026-05-08',
    endDate: '2026-06-19',
    milestone: 'QA rubric alignment',
    effort: 6,
    impact: 8,
    order: 1,
    timeframe: 'Q2',
    description:
      'Prototype scorecards that combine CSAT signals, QA rubrics, sentiment, and coaching opportunities.',
  },
  {
    id: 'item-8',
    title: 'Guided onboarding missions',
    owner: 'Lina Patel',
    team: 'Admin',
    category: 'Experience',
    phase: 'Discovery',
    status: 'On track',
    priority: 'Low',
    startDate: '2026-06-03',
    endDate: '2026-07-18',
    milestone: 'Admin journey mapping',
    effort: 3,
    impact: 5,
    order: 1,
    timeframe: 'Q3',
    description:
      'Explore a task-based onboarding experience that helps new enterprise admins configure channels quickly.',
  },
];
