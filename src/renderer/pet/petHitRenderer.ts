const DRAG_THRESHOLD = 3;
const CLICK_WINDOW = 400;
const STARTUP_DELAY = 500;

const hitEl = document.getElementById('hit')!;
let isDragging = false;
let didDrag = false;
let startX = 0;
let startY = 0;
let clickCount = 0;
let clickTimer: ReturnType<typeof setTimeout> | null = null;
let lastClickSide: 'left' | 'right' = 'left';
let ready = false;

// Prevent spurious pointer events during window creation
setTimeout(() => {
  ready = true;
}, STARTUP_DELAY);

hitEl.addEventListener('pointerdown', (e: PointerEvent) => {
  if (!ready) return;
  if (e.button === 2) {
    window.petHitAPI.contextMenu();
    return;
  }
  isDragging = true;
  didDrag = false;
  startX = e.clientX;
  startY = e.clientY;
  hitEl.setPointerCapture(e.pointerId);
  hitEl.classList.add('dragging');
});

document.addEventListener('pointermove', (e: PointerEvent) => {
  if (!isDragging) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  if (!didDrag && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
    didDrag = true;
    window.petHitAPI.dragStart();
  }
});

document.addEventListener('pointerup', (e: PointerEvent) => {
  if (!isDragging) return;
  isDragging = false;
  hitEl.classList.remove('dragging');

  if (didDrag) {
    window.petHitAPI.dragEnd();
    return;
  }

  // Click detection
  clickCount++;
  lastClickSide = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
  if (clickTimer) clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    window.petHitAPI.click({ side: lastClickSide, count: clickCount });
    clickCount = 0;
    clickTimer = null;
  }, CLICK_WINDOW);
});

document.addEventListener('contextmenu', (e) => e.preventDefault());
