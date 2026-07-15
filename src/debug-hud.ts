export interface DebugHud {
  update(lines: string[]): void;
}

export function createDebugHud(): DebugHud {
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.top = '8px';
  el.style.left = '8px';
  el.style.fontFamily = 'monospace';
  el.style.fontSize = '12px';
  el.style.lineHeight = '1.5';
  el.style.color = '#e0e0e0';
  el.style.background = 'rgba(0, 0, 0, 0.55)';
  el.style.padding = '6px 9px';
  el.style.borderRadius = '4px';
  el.style.whiteSpace = 'pre';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '1000';
  document.body.appendChild(el);

  return {
    update(lines: string[]) {
      el.textContent = lines.join('\n');
    },
  };
}
