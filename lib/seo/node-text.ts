import { isValidElement, type ReactNode } from 'react';

/**
 * Plain text of a React node — for structured data that must match the visible
 * answer (e.g. FAQPage acceptedAnswer.text when the answer is JSX with links).
 */
export function nodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return '';
}

export const plainText = (node: ReactNode): string => nodeText(node).replace(/\s+/g, ' ').trim();
