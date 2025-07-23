import type { NodePath } from '@babel/traverse';

export function getSiblingOffset(
  path: NodePath,
  offset: number,
): NodePath | null {
  const container = path.container;
  const key = path.key;

  if (typeof key !== 'number' || !Array.isArray(container)) return null;

  const nextIndex = key + offset;
  if (nextIndex >= container.length) return null;

  return path.getSibling(nextIndex);
}
export function getNextPathSibling(path: NodePath): NodePath | null {
  return getSiblingOffset(path, 1);
}
export function getPreviousPathSibling(path: NodePath): NodePath | null {
  return getSiblingOffset(path, -1);
}
