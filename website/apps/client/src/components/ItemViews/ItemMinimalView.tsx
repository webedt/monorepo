import { ReactNode } from 'react';

export interface ItemMinimalViewProps<T> {
  items: T[];
  renderRow: (item: T) => ReactNode;
  renderHeader?: () => ReactNode;
}

export default function ItemMinimalView<T>({ items, renderRow, renderHeader }: ItemMinimalViewProps<T>) {
  return (
    <div className="space-y-1">
      {renderHeader && renderHeader()}
      {items.map((item) => renderRow(item))}
    </div>
  );
}
