/**
 * Mobile keyboard behaviour, app-wide:
 *  - the focused field scrolls into view above the on-screen keyboard;
 *  - while the keyboard is open, `html.kb-open` hides the bottom nav and floating buttons;
 *  - tapping outside a text field closes the keyboard (tapping inside, or on
 *    controls marked `data-keep-focus` such as Send, does not).
 */
const TEXT_INPUT = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]), textarea, select, [contenteditable="true"]';

function isTextField(el: Element | null): el is HTMLElement {
  return !!el && el.matches(TEXT_INPUT);
}

function reveal(el: HTMLElement) {
  // Wait for the keyboard animation, then keep the field (and the area just below it) visible.
  setTimeout(() => {
    if (document.activeElement === el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 300);
}

export function initKeyboard() {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;

  document.addEventListener('focusin', (e) => {
    if (isTextField(e.target as Element)) reveal(e.target as HTMLElement);
  });

  const vv = window.visualViewport;
  if (vv) {
    const onResize = () => {
      const open = window.innerHeight - vv.height > 150 && isTextField(document.activeElement);
      root.classList.toggle('kb-open', open);
      root.style.setProperty('--kb', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
      if (open && document.activeElement) reveal(document.activeElement as HTMLElement);
    };
    vv.addEventListener('resize', onResize);
    document.addEventListener('focusout', () => setTimeout(onResize, 50));
  }

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse') return;
      const active = document.activeElement;
      if (!isTextField(active)) return;
      const target = e.target as Element;
      if (active.contains(target) || isTextField(target) || target.closest('[data-keep-focus], label')) return;
      active.blur();
    },
    true,
  );
}
