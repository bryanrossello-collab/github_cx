import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { Header } from './components/Header';
import { ItemEditorPanel } from './components/ItemEditorPanel';
import { Legend } from './components/Legend';
import { RoadmapCanvas } from './components/RoadmapCanvas';
import { Toolbar } from './components/Toolbar';
import { sampleRoadmapItems } from './data/roadmap';
import { useLocalStorage } from './hooks/useLocalStorage';
import type { Filters, Phase, RoadmapItem, ViewMode } from './types';
import {
  createRoadmapItem,
  itemMatchesFilters,
  reorderWithinPhase,
} from './utils/roadmap';

const defaultFilters: Filters = {
  query: '',
  status: 'All',
  team: 'All',
  category: 'All',
  timeframe: 'All',
  priority: 'All',
};

export default function App() {
  const [items, setItems] = useLocalStorage<RoadmapItem[]>('zenroad-items', sampleRoadmapItems);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [darkMode, setDarkMode] = useLocalStorage('zenroad-dark-mode', false);
  const [viewMode, setViewMode] = useState<ViewMode>('Swimlanes');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const visibleItems = useMemo(
    () =>
      items
        .filter((item) => itemMatchesFilters(item, filters))
        .sort((a, b) => a.order - b.order),
    [filters, items],
  );

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const handleAddItem = (phase: Phase = 'Discovery') => {
    const nextOrder =
      Math.max(0, ...items.filter((item) => item.phase === phase).map((item) => item.order)) + 1;
    const newItem = createRoadmapItem({
      id: `item-${crypto.randomUUID?.() ?? Date.now()}`,
      phase,
      order: nextOrder,
    });
    setItems((currentItems) => [...currentItems, newItem]);
    setSelectedItemId(newItem.id);
  };

  const handleSaveItem = (updatedItem: RoadmapItem) => {
    setItems((currentItems) =>
      currentItems.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
    );
  };

  const handleDeleteItem = (id: string) => {
    setItems((currentItems) => currentItems.filter((item) => item.id !== id));
    setSelectedItemId(null);
  };

  const handleMoveItem = (activeId: string, overId: string, overPhase?: Phase) => {
    setItems((currentItems) => reorderWithinPhase(currentItems, activeId, overId, overPhase));
  };

  const handleReset = () => {
    setItems(sampleRoadmapItems);
    setFilters(defaultFilters);
    setSelectedItemId(null);
    setZoom(100);
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#f5f7f9] text-slate-950 transition-colors duration-500 dark:bg-[#07121f] dark:text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(0,188,212,0.20),transparent_30%),radial-gradient(circle_at_90%_0%,rgba(64,81,181,0.18),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.96),rgba(226,232,240,0.52))] dark:bg-[radial-gradient(circle_at_12%_8%,rgba(0,188,212,0.16),transparent_30%),radial-gradient(circle_at_90%_0%,rgba(30,64,175,0.18),transparent_34%),linear-gradient(135deg,rgba(2,6,23,0.96),rgba(15,23,42,0.92))]" />
      <div className="pointer-events-none fixed left-1/2 top-24 h-72 w-72 -translate-x-1/2 rounded-full bg-teal-300/20 blur-3xl dark:bg-cyan-400/10" />

      <div className="relative">
        <Header
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((value) => !value)}
          searchTerm={filters.query}
          onSearchChange={(query) => setFilters((current) => ({ ...current, query }))}
          visibleCount={visibleItems.length}
          totalCount={items.length}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />

        <main className="mx-auto grid max-w-[1800px] gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"
          >
            <div className="grid gap-5">
              <Toolbar
                filters={filters}
                zoom={zoom}
                onFilterChange={setFilters}
                onReset={handleReset}
                onZoomChange={setZoom}
              />
              <RoadmapCanvas
                items={visibleItems}
                zoom={zoom}
                viewMode={viewMode}
                onZoomChange={setZoom}
                onAddItem={handleAddItem}
                onSelectItem={(item) => setSelectedItemId(item.id)}
                onMoveItem={handleMoveItem}
              />
            </div>
            <Legend />
          </motion.section>
        </main>
      </div>

      <motion.button
        type="button"
        onClick={() => handleAddItem()}
        initial={{ opacity: 0, scale: 0.8, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        whileHover={{ scale: 1.05, y: -3 }}
        whileTap={{ scale: 0.97 }}
        className="fixed bottom-6 right-6 z-30 inline-flex h-16 w-16 items-center justify-center rounded-[1.35rem] bg-gradient-to-br from-[#03363d] via-[#007a7a] to-cyan-400 text-white shadow-[0_24px_50px_rgba(3,54,61,0.35)] outline-none transition focus-visible:ring-4 focus-visible:ring-cyan-200 dark:from-cyan-300 dark:via-teal-300 dark:to-emerald-300 dark:text-slate-950 dark:focus-visible:ring-cyan-500/30"
        aria-label="Add roadmap item"
      >
        <Plus className="h-7 w-7" />
      </motion.button>

      <AnimatePresence>
        {selectedItem && (
          <ItemEditorPanel
            item={selectedItem}
            onClose={() => setSelectedItemId(null)}
            onSave={handleSaveItem}
            onDelete={handleDeleteItem}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
