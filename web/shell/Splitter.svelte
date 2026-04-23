<script lang="ts">
  /**
   * Drag-to-resize splitter. Parent owns the size state; this component
   * emits pointermove deltas via the `onresize` callback while the user drags.
   *
   *   <Splitter orientation="vertical" onresize={(delta) => leftWidth += delta} />
   *
   * `orientation="vertical"` means the splitter itself is a vertical line —
   * used between left and middle columns (resizing a horizontal dimension).
   * `orientation="horizontal"` is a horizontal line between rows.
   */

  type Props = {
    orientation: "vertical" | "horizontal";
    onresize: (deltaPx: number) => void;
    ondone?: () => void;
    ariaLabel?: string;
  };
  let { orientation, onresize, ondone, ariaLabel }: Props = $props();

  let dragging = $state(false);
  let lastPos = 0;

  function begin(e: PointerEvent) {
    if (e.button !== 0) return;
    dragging = true;
    lastPos = orientation === "vertical" ? e.clientX : e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function move(e: PointerEvent) {
    if (!dragging) return;
    const pos = orientation === "vertical" ? e.clientX : e.clientY;
    const delta = pos - lastPos;
    lastPos = pos;
    if (delta !== 0) onresize(delta);
  }

  function end(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    ondone?.();
  }
</script>

<div
  class="splitter {orientation}"
  class:dragging
  role="separator"
  aria-orientation={orientation}
  aria-label={ariaLabel ?? `resize ${orientation} panel`}
  onpointerdown={begin}
  onpointermove={move}
  onpointerup={end}
  onpointercancel={end}
></div>

<style>
  .splitter {
    background: transparent;
    position: relative;
    z-index: 2;
    transition: background-color 120ms ease;
  }
  .splitter.vertical {
    width: 4px;
    cursor: col-resize;
    height: 100%;
  }
  .splitter.horizontal {
    height: 4px;
    cursor: row-resize;
    width: 100%;
  }
  .splitter:hover,
  .splitter.dragging {
    background: var(--border-strong);
  }
  .splitter.vertical::before,
  .splitter.horizontal::before {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--border);
  }
  .splitter.vertical::before {
    width: 1px;
    left: 50%;
  }
  .splitter.horizontal::before {
    height: 1px;
    top: 50%;
  }
</style>
