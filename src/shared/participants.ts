export { normalizeParticipants } from '../game/rules';

const STORAGE_KEY = 'run-hoban-run:recent-participants';

export function loadParticipants(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && value.split(/\r?\n/).some((n) => n.trim()) ? value : null;
  } catch {
    return null;
  }
}

export function saveParticipants(value: string): void {
  try {
    if (value.split(/\r?\n/).some((n) => n.trim())) {
      localStorage.setItem(STORAGE_KEY, value);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage unavailable in restricted contexts.
  }
}
