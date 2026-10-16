/** Positional-parameter collector for hand-written SQL. */
export class SqlParams {
  readonly values: unknown[] = [];
  /** Add a value; returns its placeholder (`$3`). */
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}
