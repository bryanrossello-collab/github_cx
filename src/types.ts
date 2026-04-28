import type { ComponentType, SVGProps } from 'react';

export type Phase = 'Discovery' | 'Design' | 'Development' | 'Testing' | 'Launch';

export type Status = 'Planned' | 'On track' | 'At risk' | 'Blocked' | 'Complete';

export type Priority = 'Low' | 'Medium' | 'High' | 'Critical';

export type Team = 'CX Platform' | 'AI Assist' | 'Messaging' | 'Analytics' | 'Admin';

export type Timeframe = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export type ViewMode = 'Swimlanes' | 'Timeline';

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  phase: Phase;
  status: Status;
  category: string;
  team: Team;
  owner: string;
  startDate: string;
  endDate: string;
  priority: Priority;
  milestone: string;
  effort: number;
  impact: number;
  order: number;
  timeframe: Timeframe;
}

export interface Filters {
  query: string;
  status: 'All' | Status;
  team: 'All' | Team;
  category: 'All' | string;
  timeframe: 'All' | Timeframe;
  priority: 'All' | Priority;
}

export interface StatusMeta {
  label: string;
  dotClass: string;
  badgeClass: string;
  glowClass: string;
}

export interface PriorityMeta {
  label: string;
  className: string;
  accent: string;
}

export interface PhaseMeta {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  gradient: string;
  hint: string;
}
