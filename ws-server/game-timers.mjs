/** Named, serializable timers shared by Node and Durable Objects. */
export class GameTimers {
  constructor(state = { nextId: 1, tasks: new Map() }, onChange = () => {}) {
    this.state = state;
    this.onChange = onChange;
    this.handlers = {};
  }

  register(handlers) { Object.assign(this.handlers, handlers); }
  timeout(name, args, delay) { return this.add(name, args, delay, 0); }
  interval(name, args, delay) { return this.add(name, args, delay, Math.max(1, delay)); }

  add(name, args, delay, interval) {
    const id = this.state.nextId++;
    this.state.tasks.set(id, { name, args, at: Date.now() + Math.max(0, delay), interval });
    this.onChange();
    return id;
  }

  clear(id) { this.state.tasks.delete(id); this.onChange(); }
  nextAt() { return Math.min(Infinity, ...[...this.state.tasks.values()].map(task => task.at)); }

  runDue(now = Date.now()) {
    // Do not replay missed interval ticks after an eviction or outage.
    const due = [...this.state.tasks].filter(([, task]) => task.at <= now)
      .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
    for (const [id, task] of due) {
      if (!this.state.tasks.has(id)) continue;
      if (task.interval) task.at = now + task.interval;
      else this.state.tasks.delete(id);
      const handler = this.handlers[task.name];
      if (!handler) throw new Error(`Unknown timer: ${task.name}`);
      handler(...task.args);
    }
    this.onChange();
  }
}
