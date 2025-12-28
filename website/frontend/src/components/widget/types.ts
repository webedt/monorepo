/**
 * Widget System Types
 */

import type { ComponentOptions } from '../base';

export type WidgetSize = 'sm' | 'md' | 'lg' | 'xl';
export type WidgetType = 'stats' | 'activity' | 'quick-actions' | 'chart' | 'favorites' | 'session-activity' | 'custom';

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  size: WidgetSize;
  order: number;
  visible: boolean;
  settings?: Record<string, unknown>;
}

export interface WidgetOptions extends ComponentOptions {
  config: WidgetConfig;
  onRemove?: (id: string) => void;
  onResize?: (id: string, size: WidgetSize) => void;
  onSettings?: (id: string) => void;
  draggable?: boolean;
}

export interface StatsWidgetData {
  label: string;
  value: string | number;
  change?: {
    value: number;
    type: 'increase' | 'decrease' | 'neutral';
  };
  icon?: string;
}

export interface ActivityItem {
  id: string;
  title: string;
  description?: string;
  timestamp: Date;
  type: 'info' | 'success' | 'warning' | 'error';
  icon?: string;
}

export interface QuickAction {
  id: string;
  label: string;
  icon?: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface WidgetLayout {
  widgets: WidgetConfig[];
  columns: number;
}
