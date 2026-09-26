// Preserve shared references (timer arguments refer to the live room), Maps and Sets.
// The node table is internal; user-supplied object keys never act as type tags.
export function encodeSnapshot(root, socketId = () => null) {
  const nodes = [], seen = new Map();
  function encode(value) {
    if (value === undefined) return { special: 'undefined' };
    if (value === Math.random) return { special: 'random' };
    if (typeof value === 'function') throw new Error('Unregistered function in game state');
    if (value === null || typeof value !== 'object') return value;
    const socket = socketId(value);
    if (socket) return { socket };
    if (seen.has(value)) return { ref: seen.get(value) };
    const id = nodes.length;
    seen.set(value, id);
    nodes.push(null);
    if (value instanceof Map) nodes[id] = ['map', [...value].map(([k, v]) => [encode(k), encode(v)])];
    else if (value instanceof Set) nodes[id] = ['set', [...value].map(encode)];
    else if (Array.isArray(value)) nodes[id] = ['array', value.map(encode)];
    else nodes[id] = ['object', Object.entries(value).map(([k, v]) => [k, encode(v)])];
    return { ref: id };
  }
  const entry = encode(root);
  return JSON.stringify({ version: 1, entry, nodes });
}

export function decodeSnapshot(text, socket = () => null) {
  const { version, entry, nodes } = JSON.parse(text);
  if (version !== 1) throw new Error('Unsupported snapshot version');
  const values = nodes.map(([type]) => type === 'map' ? new Map() : type === 'set' ? new Set() : type === 'array' ? [] : {});
  function decode(value) {
    if (value === null || typeof value !== 'object') return value;
    if (value.special === 'undefined') return undefined;
    if (value.special === 'random') return Math.random;
    if (value.socket) return socket(value.socket);
    return values[value.ref];
  }
  nodes.forEach(([type, entries], i) => {
    const target = values[i];
    if (type === 'map') for (const [k, v] of entries) target.set(decode(k), decode(v));
    else if (type === 'set') for (const v of entries) target.add(decode(v));
    else if (type === 'array') for (const v of entries) target.push(decode(v));
    else for (const [k, v] of entries) Object.defineProperty(target, k, {
      value: decode(v), enumerable: true, writable: true, configurable: true,
    });
  });
  return decode(entry);
}
