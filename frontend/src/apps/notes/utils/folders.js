// Helpers over the flat folder list the server sends ({ id, name, parentId, noteCount }).

export const MAX_FOLDER_DEPTH = 10;

export function buildTree(folders) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map();
  for (const f of folders) {
    const key = f.parentId && byId.has(f.parentId) ? f.parentId : null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(f);
  }
  const kids = (id) => children.get(id ?? null) || [];

  // The folder and everything inside it.
  const subtree = (id) => {
    const out = [];
    const walk = (fid) => {
      out.push(fid);
      kids(fid).forEach((c) => walk(c.id));
    };
    walk(id);
    return out;
  };

  // Names from the top down, e.g. ["Work", "Clients"].
  const pathNames = (id) => {
    const names = [];
    for (let f = byId.get(id); f; f = byId.get(f.parentId)) names.unshift(f.name);
    return names;
  };

  const depth = (id) => pathNames(id).length;
  const height = (id) => 1 + Math.max(0, ...kids(id).map((c) => height(c.id)));
  const noteTotal = (id) => subtree(id).reduce((n, fid) => n + (byId.get(fid)?.noteCount || 0), 0);

  return { byId, kids, subtree, pathNames, depth, height, noteTotal };
}
