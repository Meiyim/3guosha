export interface SelectorOpts<T> {
  items: T[];
  filter?: (item: T, index: number) => boolean;
  onConfirm: (item: T, index: number) => void;
  onCancel: () => void;
}

export class Selector<T> {
  items: T[] = [];
  cursor: number = 0;
  filter?: (item: T, index: number) => boolean;
  onConfirm: (item: T, index: number) => void;
  onCancel: () => void;

  constructor(opts: SelectorOpts<T>) {
    this.items = opts.items;
    this.filter = opts.filter;
    this.onConfirm = opts.onConfirm;
    this.onCancel = opts.onCancel;
  }

  setItems(items: T[]) {
    this.items = items;
    if (this.cursor >= items.length) this.cursor = Math.max(0, items.length - 1);
  }

  next() {
    if (this.items.length === 0) return;
    this.cursor = Math.min(this.cursor + 1, this.items.length - 1);
  }

  prev() {
    if (this.items.length === 0) return;
    this.cursor = Math.max(0, this.cursor - 1);
  }

  confirm() {
    const item = this.items[this.cursor];
    if (item === undefined) return;
    if (this.filter && !this.filter(item, this.cursor)) return;
    this.onConfirm(item, this.cursor);
  }

  cancel() { this.onCancel(); }

  get current(): T | undefined { return this.items[this.cursor]; }

  isSelectable(index?: number): boolean {
    const i = index ?? this.cursor;
    const item = this.items[i];
    if (item === undefined) return false;
    if (!this.filter) return true;
    return this.filter(item, i);
  }
}
