// Widget Base
export { Widget } from './Widget';

// Widget Components
export { StatsWidget } from './StatsWidget';
export { ActivityWidget } from './ActivityWidget';
export { QuickActionsWidget } from './QuickActionsWidget';
export { ChartWidget } from './ChartWidget';

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
export type { WidgetContainerOptions } from './WidgetContainer';
export type { WidgetCustomizerOptions } from './WidgetCustomizer';
