import { useEffect, useState, useRef, type ReactNode } from 'react';
import { fetchDashboardData } from './api/dashboard';
import type { DashboardData } from './types';
import { KPICards } from './components/KPICards';
import { BurndownChart } from './components/BurndownChart';
import { StatusDistribution } from './components/StatusDistribution';
import { WorkloadChart } from './components/WorkloadChart';
import { DelayAnalysis } from './components/DelayAnalysis';
import { TrackerPieChart } from './components/TrackerPieChart';
import { VersionProgressList } from './components/VersionProgressList';
import { VelocityChart } from './components/VelocityChart';
import { PriorityChart } from './components/PriorityChart';
import { CumulativeFlowChart } from './components/CumulativeFlowChart';
import { CycleTimeChart } from './components/CycleTimeChart';
import { IssueListPanel } from './components/IssueListPanel';

import { AiAnalysisModal } from './components/AiAnalysisModal';
import { ProjectFilter } from './components/ProjectFilter';
import { analyzeDashboard } from './api/dashboard';

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Props {
  projectId: string;
}

interface SortableItemProps {
  id: string;
  children: ReactNode;
}

function SortableItem({ id, children }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        {...listeners}
        style={{
          cursor: 'grab',
          padding: '4px 8px',
          backgroundColor: '#f0f0f0',
          borderRadius: '4px 4px 0 0',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: '#888',
          userSelect: 'none',
        }}
      >
        ⠿
      </div>
      {children}
    </div>
  );
}

const DEFAULT_PANEL_ORDER = [
  'kpi',
  'burndown',
  'velocity',
  'status_dist',
  'tracker_dist',
  'priority_dist',
  'cumulative_flow',
  'cycle_time',
  'workload',
  'delay',
  'version_progress',
  'issue_list',
];

// PANEL_LABELS moved to dynamic labels from backend

function App({ projectId }: Props) {
  const STORAGE_KEY = `redmine_progress_dashboard:dashboard_projects_${projectId}`;
  const LAYOUT_STORAGE_KEY = `redmine_progress_dashboard:dashboard_panel_order_${projectId}_v1`;
  const VISIBILITY_STORAGE_KEY = `redmine_progress_dashboard:dashboard_panel_visibility_${projectId}_v1`;

  const readStorage = (key: string): string | null => {
    return localStorage.getItem(key);
  };

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Outside click handler for settings
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [panelOrder, setPanelOrder] = useState<string[]>(() => {
    const saved = readStorage(LAYOUT_STORAGE_KEY);
    if (saved) {
      const savedOrder = JSON.parse(saved) as string[];
      // Add any new panels from default that are missing in saved order
      const missingPanels = DEFAULT_PANEL_ORDER.filter(id => !savedOrder.includes(id));
      return [...savedOrder, ...missingPanels];
    }
    return DEFAULT_PANEL_ORDER;
  });

  const [visiblePanels, setVisiblePanels] = useState<Record<string, boolean>>(() => {
    const saved = readStorage(VISIBILITY_STORAGE_KEY);
    // Start with all panels visible by default
    const defaults = DEFAULT_PANEL_ORDER.reduce((acc, id) => ({ ...acc, [id]: true }), {} as Record<string, boolean>);
    if (saved) {
      // Merge saved state with defaults (new panels default to visible)
      return { ...defaults, ...JSON.parse(saved) };
    }
    return defaults;
  });

  const togglePanelVisibility = (panelId: string) => {
    setVisiblePanels((prev) => {
      const newState = { ...prev, [panelId]: !prev[panelId] };
      localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(newState));
      return newState;
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setPanelOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(newOrder));
        return newOrder;
      });
    }
  };

  // Initialize from LocalStorage if available
  const [targetProjectIds, setTargetProjectIds] = useState<number[]>(() => {
    const saved = readStorage(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  // Track if we have initialized from data (for first load case)
  const [isInitialized, setIsInitialized] = useState(() => !!readStorage(STORAGE_KEY));

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [analysisText, setAnalysisText] = useState<string | null>(null);
  const [promptContent, setPromptContent] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    setIsModalOpen(true);
    setAnalyzing(true);
    setAnalysisText(null); // Clear previous analysis
    setPromptContent(null); // Clear previous prompt
    try {
      // Preview mode: fetch prompt only
      const result = await analyzeDashboard(projectId, { mode: 'preview', target_project_ids: targetProjectIds });
      setPromptContent(result.prompt);
    } catch (error) {
      console.error(error);
      setPromptContent('プロンプトの生成に失敗しました。');
    } finally {
      setAnalyzing(false); // Stop loading after prompt is fetched
    }
  };

  const handleGenerate = async (provider: string, prompt: string) => {
    setAnalyzing(true);
    setAnalysisText(null);
    try {
      const result = await analyzeDashboard(projectId, { provider, prompt, target_project_ids: targetProjectIds });
      setAnalysisText(result.analysis);
    } catch (error) {
      console.error(error);
      setAnalysisText(data?.labels.ai_analysis_failed || '分析に失敗しました。詳細については管理者に問い合わせてください。');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleProjectChange = (ids: number[]) => {
    setTargetProjectIds(ids);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    setIsInitialized(true);
  };

  useEffect(() => {
    const params: { target_project_ids?: number[] } = {};
    if (isInitialized) {
      params.target_project_ids = targetProjectIds.length > 0 ? targetProjectIds : [-1];
    }

    fetchDashboardData(projectId, params).then(d => {
      setData(d);
      if (!isInitialized && d.available_projects) {
        const currentId = Number(projectId);
        const availableIds = d.available_projects.map(p => p.id);
        const defaultIds = availableIds.includes(currentId) ? [currentId] : availableIds;
        setTargetProjectIds(defaultIds);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultIds));
        setIsInitialized(true);
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, [projectId, targetProjectIds, isInitialized, STORAGE_KEY]);

  if (loading) return <div>{data?.labels?.loading || 'Loading dashboard data...'}</div>;
  if (!data) return <div>Error loading data. Check console.</div>;

  const panelComponents: Record<string, ReactNode> = {
    kpi: <KPICards data={data.kpis} labels={data.labels} />,
    burndown: <BurndownChart data={data.burndown} labels={data.labels} />,
    velocity: <VelocityChart data={data.velocity} labels={data.labels} />,
    status_dist: <StatusDistribution data={data.status_distribution} labels={data.labels} />,
    tracker_dist: <TrackerPieChart data={data.tracker_distribution} labels={data.labels} />,
    workload: <WorkloadChart data={data.workload} labels={data.labels} />,
    delay: <DelayAnalysis data={data.delay_analysis} labels={data.labels} />,
    version_progress: <VersionProgressList data={data.version_progress} labels={data.labels} />,
    priority_dist: <PriorityChart data={data.priority_distribution} labels={data.labels} />,
    cumulative_flow: <CumulativeFlowChart data={data.cumulative_flow} labels={data.labels} />,
    cycle_time: <CycleTimeChart data={data.cycle_time} labels={data.labels} />,
    issue_list: <IssueListPanel issues={data.issues} labels={data.labels} baseUrl={window.location.origin} />,
  };

  const visiblePanelOrder = panelOrder.filter((id) => visiblePanels[id]);

  return (
    <div className="dashboard-container" style={{ padding: '1rem', fontFamily: 'Sans-Serif', background: '#f6f6f6' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexShrink: 0 }}>
          {data.available_projects && (
            <ProjectFilter
              projects={data.available_projects}
              selectedIds={targetProjectIds}
              onChange={handleProjectChange}
            />
          )}

          {/* Settings Button */}
          <div style={{ position: 'relative', display: 'inline-block' }} ref={settingsRef}>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              style={{
                padding: '0 12px',
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                fontWeight: 500,
                fontSize: '0.9rem',
                color: '#333',
                transition: 'all 0.2s ease',
                height: '32px'
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = '#bbb'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = '#ddd'}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1rem' }}>⚙️</span>
                {data.labels.display_settings}
              </span>
              <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{settingsOpen ? '▲' : '▼'}</span>
            </button>

            {settingsOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: 'auto',
                  right: 0,
                  background: '#fff',
                  borderRadius: '12px',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                  zIndex: 1000,
                  minWidth: '220px',
                  width: 'max-content',
                  maxWidth: '90vw',
                  padding: '0.8rem',
                  border: '1px solid rgba(0,0,0,0.05)'
                }}
              >
                <div style={{ padding: '0 0.5rem 0.8rem 0.5rem', borderBottom: '1px solid #f0f0f0', marginBottom: '0.5rem' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }}>{data.labels.panel_display}</div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => {
                        const newVisibility = DEFAULT_PANEL_ORDER.reduce((acc, id) => ({ ...acc, [id]: true }), {});
                        setVisiblePanels(newVisibility);
                        localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(newVisibility));
                      }}
                      style={{
                        background: '#f0f2f5',
                        border: 'none',
                        color: '#1976d2',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontWeight: 500
                      }}
                    >
                      {data.labels.select_all}
                    </button>
                    <button
                      onClick={() => {
                        const newVisibility = DEFAULT_PANEL_ORDER.reduce((acc, id) => ({ ...acc, [id]: false }), {});
                        setVisiblePanels(newVisibility);
                        localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(newVisibility));
                      }}
                      style={{
                        background: '#f0f2f5',
                        border: 'none',
                        color: '#1976d2',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontWeight: 500
                      }}
                    >
                      {data.labels.clear}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  {DEFAULT_PANEL_ORDER.map((panelId) => (
                    <label
                      key={panelId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '8px 12px',
                        cursor: 'pointer',
                        userSelect: 'none',
                        borderRadius: '6px',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f8f9fa'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <input
                        type="checkbox"
                        checked={visiblePanels[panelId] ?? true}
                        onChange={() => togglePanelVisibility(panelId)}
                        style={{
                          width: '16px',
                          height: '16px',
                          cursor: 'pointer',
                          accentColor: '#6e8efb',
                          marginRight: '0.5rem'
                        }}
                      />
                      <span style={{ color: '#444' }}>{data.labels[panelId]}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleAnalyze}
            style={{
              padding: '0 12px',
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              fontWeight: 500,
              fontSize: '0.9rem',
              color: '#333',
              transition: 'all 0.2s ease',
              height: '32px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = '#bbb'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = '#ddd'}
          >
            <span>✨</span> {data.labels.ai_analyze}
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={visiblePanelOrder} strategy={rectSortingStrategy}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
            {visiblePanelOrder.map((panelId) => (
              <SortableItem key={panelId} id={panelId}>
                {panelComponents[panelId]}
              </SortableItem>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <AiAnalysisModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        content={analysisText}
        initialPrompt={promptContent}
        loading={analyzing}
        onGenerate={handleGenerate}
        labels={data?.labels}
      />
    </div>
  );
}
export default App;
