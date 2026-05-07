<script lang="ts">
  import CollapseHeader from "./CollapseHeader.svelte";
  import FamilyTree from "./FamilyTree.svelte";
  import ColumnDict from "./ColumnDict.svelte";
  import TableList from "./TableList.svelte";
  import Splitter from "../shell/Splitter.svelte";

  type Props = {
    onSelectApi: (family: string, resource: string, version?: string) => void;
    onSelectColumn: (name: string) => void;
    onSelectTable: (name: string) => void;
    selectedFamily?: string;
    selectedResource?: string;
    selectedColumn?: string;
    selectedTable?: string;
  };
  let {
    onSelectApi,
    onSelectColumn,
    onSelectTable,
    selectedFamily,
    selectedResource,
    selectedColumn,
    selectedTable,
  }: Props = $props();

  // Expanded / collapsed per section
  let showFamilies = $state(true);
  let showColumns = $state(true);
  let showTables = $state(true);

  // Flex basis for each section in FR units (only applies when section is expanded).
  let familiesFr = $state(1);
  let columnsFr = $state(1.2);
  let tablesFr = $state(0.8);

  const STORAGE = "acx:sidebar:v1";

  $effect(() => {
    try {
      const saved = localStorage.getItem(STORAGE);
      if (saved) {
        const p = JSON.parse(saved) as Partial<{
          showFamilies: boolean;
          showColumns: boolean;
          showTables: boolean;
          familiesFr: number;
          columnsFr: number;
          tablesFr: number;
        }>;
        if (typeof p.showFamilies === "boolean") showFamilies = p.showFamilies;
        if (typeof p.showColumns === "boolean") showColumns = p.showColumns;
        if (typeof p.showTables === "boolean") showTables = p.showTables;
        if (typeof p.familiesFr === "number") familiesFr = p.familiesFr;
        if (typeof p.columnsFr === "number") columnsFr = p.columnsFr;
        if (typeof p.tablesFr === "number") tablesFr = p.tablesFr;
      }
    } catch {
      /* ignore */
    }
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({ showFamilies, showColumns, showTables, familiesFr, columnsFr, tablesFr }),
      );
    }, 300);
  }

  // When a splitter is dragged, shift fr units between the adjacent expanded
  // sections. We convert the pixel delta into fr units by using the container's
  // current pixel-to-fr ratio from `ResizeObserver`.
  let containerEl: HTMLElement | undefined = $state();
  let containerHeight = $state(0);

  $effect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) containerHeight = e.contentRect.height;
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  });

  function frFor(section: "families" | "columns" | "tables") {
    if (section === "families") return showFamilies ? familiesFr : 0;
    if (section === "columns") return showColumns ? columnsFr : 0;
    return showTables ? tablesFr : 0;
  }

  function totalFr() {
    return frFor("families") + frFor("columns") + frFor("tables");
  }

  function pixelToFr(delta: number): number {
    // Each section's flex-basis is fr; fr-to-pixel ≈ containerHeight / totalFr.
    // So pixel delta ÷ (containerHeight / totalFr) = fr delta.
    const tf = totalFr();
    if (containerHeight <= 0 || tf <= 0) return 0;
    return (delta / containerHeight) * tf;
  }

  function resizeFamiliesColumns(deltaPx: number) {
    if (!showFamilies || !showColumns) return;
    const d = pixelToFr(deltaPx);
    const newFamilies = Math.max(0.3, familiesFr + d);
    const newColumns = Math.max(0.3, columnsFr - d);
    familiesFr = newFamilies;
    columnsFr = newColumns;
    persist();
  }

  function resizeColumnsTables(deltaPx: number) {
    if (!showColumns || !showTables) return;
    const d = pixelToFr(deltaPx);
    const newColumns = Math.max(0.3, columnsFr + d);
    const newTables = Math.max(0.3, tablesFr - d);
    columnsFr = newColumns;
    tablesFr = newTables;
    persist();
  }

  function togglePanel(which: "families" | "columns" | "tables") {
    if (which === "families") showFamilies = !showFamilies;
    if (which === "columns") showColumns = !showColumns;
    if (which === "tables") showTables = !showTables;
    persist();
  }
</script>

<div class="sidebar" bind:this={containerEl}>
  <CollapseHeader
    title="Families"
    count={showFamilies ? undefined : "collapsed"}
    expanded={showFamilies}
    onToggle={() => togglePanel("families")}
  />
  {#if showFamilies}
    <div class="section" style="flex: {familiesFr};">
      <FamilyTree {onSelectApi} {selectedFamily} {selectedResource} />
    </div>
  {/if}

  {#if showFamilies && showColumns}
    <Splitter orientation="horizontal" onresize={resizeFamiliesColumns} ariaLabel="resize families and columns sections" />
  {/if}

  <CollapseHeader
    title="Columns"
    count={showColumns ? undefined : "collapsed"}
    expanded={showColumns}
    onToggle={() => togglePanel("columns")}
  />
  {#if showColumns}
    <div class="section" style="flex: {columnsFr};">
      <ColumnDict {onSelectColumn} {selectedColumn} />
    </div>
  {/if}

  {#if showColumns && showTables}
    <Splitter orientation="horizontal" onresize={resizeColumnsTables} ariaLabel="resize columns and tables sections" />
  {/if}

  <CollapseHeader
    title="Tables"
    count={showTables ? undefined : "collapsed"}
    expanded={showTables}
    onToggle={() => togglePanel("tables")}
  />
  {#if showTables}
    <div class="section" style="flex: {tablesFr};">
      <TableList {onSelectTable} {selectedTable} />
    </div>
  {/if}
</div>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .section {
    flex: 1;
    min-height: 60px;
    overflow: auto;
    position: relative;
  }
</style>
