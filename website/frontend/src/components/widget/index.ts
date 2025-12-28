// Widget Base
export { Widget } from './Widget';

// Widget Components
export { StatsWidget } from './StatsWidget';
export { ActivityWidget } from './ActivityWidget';
export { QuickActionsWidget } from './QuickActionsWidget';
export { ChartWidget } from './ChartWidget';
export { CommunityActivityWidget } from './CommunityActivityWidget';
export { FavoritesWidget } from './FavoritesWidget';
export { SessionActivityWidget } from './SessionActivityWidget';

// Widget Container
export { WidgetContainer } from './WidgetContainer';

// Widget Customizer
export { WidgetCustomizer } from './WidgetCustomizer';

// Types
export type {
  WidgetSize,
  WidgetType,
  WidgetConfig,
  WidgetOptions,
  WidgetLayout,
  StatsWidgetData,
  ActivityItem,
  QuickAction,
  ChartDataPoint,
} from './types';

export type { StatsWidgetOptions } from './StatsWidget';
export type { ActivityWidgetOptions } from './ActivityWidget';
export type { QuickActionsWidgetOptions } from './QuickActionsWidget';
export type { ChartWidgetOptions, ChartType } from './ChartWidget';
export type { CommunityActivityWidgetOptions } from './CommunityActivityWidget';
export type { FavoritesWidgetOptions } from './FavoritesWidget';
export type { SessionActivityWidgetOptions } from './SessionActivityWidget';
export type { WidgetContainerOptions } from './WidgetContainer';
export type { WidgetCustomizerOptions } from './WidgetCustomizer';
