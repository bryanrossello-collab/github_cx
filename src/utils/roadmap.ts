import type { Filters, Phase, RoadmapItem } from '../types';

export function createRoadmapItem(overrides: Partial<RoadmapItem> = {}): RoadmapItem {
  const now = Date.now();

  return {
    id: `item-${now}`,
    title: 'New roadmap initiative',
    owner: 'Unassigned',
    team: 'CX Platform',
    category: 'Platform',
    phase: 'Discovery',
    status: 'Planned',
    priority: 'Medium',
    timeframe: 'Q2',
    startDate: '2026-05-01',
    endDate: '2026-06-15',
    milestone: 'Draft milestone',
    effort: 3,
    impact: 7,
    order: now,
    description: 'Describe the customer problem, desired outcome, and launch criteria.',
    ...overrides,
  };
}

export function sortByOrder(items: RoadmapItem[]) {
  return [...items].sort((a, b) => a.order - b.order);
}

export function itemMatchesFilters(item: RoadmapItem, filters: Filters) {
  const query = filters.query.trim().toLowerCase();
  const matchesQuery =
    query.length === 0 ||
    [
      item.title,
      item.description,
      item.owner,
      item.milestone,
      item.team,
      item.category,
      item.priority,
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);

  return (
    matchesQuery &&
    (filters.status === 'All' || item.status === filters.status) &&
    (filters.team === 'All' || item.team === filters.team) &&
    (filters.category === 'All' || item.category === filters.category) &&
    (filters.timeframe === 'All' || item.timeframe === filters.timeframe)
  );
}

export function formatDateRange(startDate: string, endDate: string) {
  const formatter = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  });

  return `${formatter.format(new Date(startDate))} - ${formatter.format(new Date(endDate))}`;
}

export function reorderWithinPhase(
  items: RoadmapItem[],
  activeId: string,
  overId: string,
  targetPhase?: Phase,
) {
  const activeItem = items.find((item) => item.id === activeId);
  const overItem = items.find((item) => item.id === overId);

  if (!activeItem || !overItem) {
    return items;
  }

  const phase = targetPhase ?? overItem.phase;
  const movedItems = items.map((item) =>
    item.id === activeId ? { ...item, phase } : item,
  );
  const phaseItems = sortByOrder(movedItems.filter((item) => item.phase === phase));
  const withoutActive = phaseItems.filter((item) => item.id !== activeId);
  const overIndex = Math.max(
    0,
    withoutActive.findIndex((item) => item.id === overId),
  );
  const activeWithPhase = movedItems.find((item) => item.id === activeId)!;
  withoutActive.splice(overIndex, 0, activeWithPhase);
  const orderById = new Map(withoutActive.map((item, index) => [item.id, index + 1]));

  return movedItems.map((item) =>
    orderById.has(item.id) ? { ...item, phase, order: orderById.get(item.id)! } : item,
  );
}

export function moveToPhase(items: RoadmapItem[], activeId: string, phase: Phase) {
  const phaseItems = items.filter((item) => item.phase === phase);
  const nextOrder = phaseItems.length
    ? Math.max(...phaseItems.map((item) => item.order)) + 1
    : 1;

  return items.map((item) =>
    item.id === activeId ? { ...item, phase, order: nextOrder } : item,
  );
}
