import React, { useMemo, useState } from "react";

// Local background cover (no global CSS changes)
function BackgroundCover() {
  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, background: '#f6f7fb', zIndex: 0 }} />
  );
}

// ------------------------------
// Dynamic loader for Tau‑Prolog UMD (browser-safe, no fs)
// ------------------------------
const TAU_CORE_URL = "https://cdn.jsdelivr.net/npm/tau-prolog@0.3.3/tau-prolog.min.js";
const TAU_LISTS_URL = "https://cdn.jsdelivr.net/npm/tau-prolog@0.3.3/modules/lists.min.js";

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const exists = Array.from(document.scripts).some(s => s.src === src);
    if (exists) return resolve();
    const el = document.createElement("script");
    el.src = src; el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load script ${src}`));
    document.head.appendChild(el);
  });
}

let _tauReady: Promise<any> | null = null;
async function ensureTauProlog(): Promise<any | null> {
  if (_tauReady) return _tauReady;
  _tauReady = (async () => {
    try {
      await loadScript(TAU_CORE_URL);
      // @ts-ignore – UMD attaches global `pl`
      const pl = (window as any).pl;
      if (!pl) return null;
      await loadScript(TAU_LISTS_URL);
      return pl;
    } catch {
      return null;
    }
  })();
  return _tauReady;
}

// ------------------------------
// Prolog rules
// ------------------------------
const PROLOG_RULES = `
% Facts provided at runtime:
% slot(Id, Row, Col, Dir, Len). Dir=h;v
% cross(A, IA, B, IB).
% word(W).
all_different([]).
all_different([X|Xs]) :- \\+ member(X,Xs), all_different(Xs).
fit_word(W, Len) :- atom_length(W, Len).
assign(slot(Id,_,_,_,Len), assign(Id,W)) :- word(W), fit_word(W,Len).
chars(A, Cs) :- atom_chars(A, Cs).
consistent(Assigns) :-
  findall(cross(A,IA,B,IB), cross(A,IA,B,IB), Cs),
  forall(
    member(cross(A,IA,B,IB), Cs),
    (
      member(assign(A,WA), Assigns),
      member(assign(B,WB), Assigns),
      chars(WA, CA), chars(WB, CB),
      nth0(IA, CA, X), nth0(IB, CB, X)
    )
  ).
solve(Assigns) :-
  findall(slot(Id,R,C,D,L), slot(Id,R,C,D,L), Slots),
  maplist(assign, Slots, Assigns),
  maplist(arg(2), Assigns, Ws),
  all_different(Ws),
  consistent(Assigns).
`;

// ------------------------------
// Utilities
// ------------------------------
function make2D(rows: number, cols: number, fill: any) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => (typeof fill === 'function' ? fill() : JSON.parse(JSON.stringify(fill)))));
}

type Cell = { blocked: boolean; ch?: string };

type Slot = { id: number; r: number; c: number; len: number; dir: "H" | "V" };

type Mapping = Record<number, string>;

// ------------------------------
// Styles (centered, no global CSS)
// ------------------------------
const S = {
  page: {
    minHeight: '100vh',
    width: '100vw',
    background: 'transparent',
    color: '#111827',
    padding: 24,
    boxSizing: 'border-box' as const,
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    display: 'flex',
    justifyContent: 'center',
    position: 'relative' as const,
    zIndex: 1,
  },
  container: { maxWidth: 1120, width: '100%', display: 'grid', gap: 24 },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' as const },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
  h1: { fontSize: 28, fontWeight: 700, margin: 0 },
  small: { color: '#6b7280', fontSize: 12 },
  label: { width: 110, display: 'inline-block', fontSize: 14 },
  input: { width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid #d1d5db' },
  btn: { padding: '8px 12px', borderRadius: 12, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', color: '#111827' },
  btnPrimary: { padding: '8px 12px', borderRadius: 12, border: '1px solid #111827', background: '#111827', color: '#fff', cursor: 'pointer' },
  textarea: { width: '100%', height: 160, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, borderRadius: 8, border: '1px solid #d1d5db', padding: 8, resize: 'none'},
  gridWrap: { overflow: 'auto' as const },
  grid: (cols: number) => ({ display: 'inline-grid', gridTemplateColumns: `repeat(${cols}, 36px)`, gap: 5 }),
  cell: (blocked: boolean, hasLetter: boolean) => ({
    width: 36, height: 36, border: '1px solid #d1d5db', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 600, userSelect: 'none' as const, background: blocked ? '#111827' : '#ffffff', color: blocked ? '#111827' : (hasLetter ? '#111827' : '#1f2937'),
    borderRadius: 6,
  }),
  tipsLi: { marginBottom: 6 },
};

export default function CrosswordApp() {
  const [rows, setRows] = useState(10);
  const [cols, setCols] = useState(10);
  const [grid, setGrid] = useState<Cell[][]>(() => make2D(10, 10, { blocked: true }));
  const [wordsText, setWordsText] = useState<string>(
    "PROLOG\nLINUX\nKERNEL\nPYTHON\nJAVA\nARRAY\nQUEUE\nSTACK\nGRAPH\nHEAP\nCLASS\nOBJECT\nTHREAD\nLOCK\nMUTEX\nATOMIC"
  );
  const [solved, setSolved] = useState<Cell[][] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [testOutput, setTestOutput] = useState<string>("");
  const [patternInfo, setPatternInfo] = useState<string>("");
  const [wordsInfo, setWordsInfo] = useState<string>("");

  const applySize = () => {
    setSolved(null);
    setGrid(make2D(rows, cols, { blocked: true }));
  };

  const toggleCell = (r: number, c: number) => {
    if (busy) return;
    setSolved(null);
    setGrid(g => {
      const next = g.map(row => row.map(cell => ({ ...cell })));
      next[r][c] = { blocked: !next[r][c].blocked };
      return next;
    });
  };

  const words = useMemo(() => wordsText
    .split(/\r?\n|[;,]+/)
    .map(w => w.toUpperCase().replace(/[^A-Z]/g, "").trim())
    .filter(w => w.length >= 2), [wordsText]);

  // Identify maximal open runs (len>=2) as slots
  const computeSlots = (g: Cell[][]): Slot[] => {
    const slots: Slot[] = [];
    let id = 0;
    // Horizontal
    for (let r = 0; r < g.length; r++) {
      let c = 0;
      while (c < g[0].length) {
        while (c < g[0].length && g[r][c].blocked) c++;
        const start = c;
        while (c < g[0].length && !g[r][c].blocked) c++;
        const len = c - start;
        if (len >= 2) slots.push({ id: id++, r, c: start, len, dir: "H" });
      }
    }
    // Vertical
    for (let c = 0; c < g[0].length; c++) {
      let r = 0;
      while (r < g.length) {
        while (r < g.length && g[r][c].blocked) r++;
        const start = r;
        while (r < g.length && !g[r][c].blocked) r++;
        const len = r - start;
        if (len >= 2) slots.push({ id: id++, r: start, c, len, dir: "V" });
      }
    }
    return slots;
  };

  // Build crossing constraints
  function buildCrosses(slots: Slot[]) {
    const crosses: { a: number; ia: number; b: number; ib: number }[] = [];
    const mark = new Map<string, { slotId: number; off: number }[]>();
    const key = (r: number, c: number) => `${r},${c}`;
    for (const s of slots) {
      for (let k = 0; k < s.len; k++) {
        const rr = s.dir === "H" ? s.r : s.r + k;
        const cc = s.dir === "H" ? s.c + k : s.c;
        const arr = mark.get(key(rr, cc)) ?? [];
        arr.push({ slotId: s.id, off: k });
        mark.set(key(rr, cc), arr);
      }
    }
    for (const arr of mark.values()) {
      if (arr.length < 2) continue;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          crosses.push({ a: arr[i].slotId, ia: arr[i].off, b: arr[j].slotId, ib: arr[j].off });
        }
      }
    }
    return crosses;
  }

  // ------------------------------
  // JS fallback solver (MRV backtracking)
  // ------------------------------
  function solveJS(g: Cell[][], wordList: string[]): Mapping | null {
    const slots = computeSlots(g);
    if (slots.length === 0) return null;
    const crosses = buildCrosses(slots);

    const byLen = new Map<number, string[]>();
    for (const w of wordList) {
      const L = w.length; if (!byLen.has(L)) byLen.set(L, []);
      byLen.get(L)!.push(w);
    }

    const fixed: Map<number, Map<number, string>> = new Map();
    for (const s of slots) {
      const m = new Map<number, string>();
      for (let k = 0; k < s.len; k++) {
        const rr = s.dir === "H" ? s.r : s.r + k;
        const cc = s.dir === "H" ? s.c + k : s.c;
        const ch = g[rr][cc].ch?.toUpperCase();
        if (ch && /[A-Z]/.test(ch)) m.set(k, ch);
      }
      fixed.set(s.id, m);
    }

    const crossingMap = new Map<number, { otherId: number; idxThis: number; idxOther: number }[]>();
    for (const s of slots) crossingMap.set(s.id, []);
    for (const c of crosses) {
      crossingMap.get(c.a)!.push({ otherId: c.b, idxThis: c.ia, idxOther: c.ib });
      crossingMap.get(c.b)!.push({ otherId: c.a, idxThis: c.ib, idxOther: c.ia });
    }

    const assignment: Mapping = {};
    const used = new Set<string>();

    function domainFor(s: Slot): string[] {
      const base = (byLen.get(s.len) ?? []).filter(w => !used.has(w));
      const fx = fixed.get(s.id)!;
      return base.filter(w => {
        for (const [i, ch] of fx.entries()) if (w[i] !== ch) return false;
        for (const x of crossingMap.get(s.id)!) {
          const other = assignment[x.otherId];
          if (other && other[x.idxOther] !== w[x.idxThis]) return false;
        }
        return true;
      });
    }

    function pickNext(): Slot | null {
      let best: { s: Slot; size: number } | null = null;
      for (const s of slots) {
        if (assignment[s.id]) continue;
        const d = domainFor(s);
        const size = d.length;
        if (best === null || size < best.size) best = { s, size };
        if (size === 0) return s; // immediate failure branch
      }
      return best ? best.s : null;
    }

    function backtrack(): boolean {
      const s = pickNext();
      if (!s) return true; // all assigned
      const dom = domainFor(s);
      if (dom.length === 0) return false;
      for (const w of dom) {
        assignment[s.id] = w; used.add(w);
        if (backtrack()) return true;
        delete assignment[s.id]; used.delete(w);
      }
      return false;
    }

    return backtrack() ? assignment : null;
  }

  // ------------------------------
  // Prolog-first solver with safe fallback to JS
  // ------------------------------
  async function solveFor(g: Cell[][], wordList: string[]): Promise<Mapping | null> {
    const slots = computeSlots(g);
    if (slots.length === 0) return null;

    const pl = await ensureTauProlog();
    if (!pl) {
      return solveJS(g, wordList);
    }

    const crosses = buildCrosses(slots);
    const facts = [
      ...slots.map(s => `slot(${s.id},${s.r},${s.c},${s.dir === 'H' ? 'h' : 'v'},${s.len}).`),
      ...crosses.map(c => `cross(${c.a},${c.ia},${c.b},${c.ib}).`),
      ...wordList.map(w => `word('${w}').`),
    ].join("\n");

    const session = pl.create(200000);
    await new Promise<void>((resolve, reject) => session.consult(facts + "\n" + PROLOG_RULES, { success: resolve, error: reject }));

    return await new Promise<Mapping | null>((resolve) => {
      session.query("solve(Assigns).", {
        success: () => {
          session.answer((ans: any) => {
            if (!ans || ans === false || ans === null) return resolve(null);
            const assignsTerm = typeof ans.lookup === 'function'
              ? ans.lookup("Assigns")
              : (ans.links?.get?.("Assigns") ?? ans.links?.Assigns ?? null);
            if (!assignsTerm) return resolve(null);
            const mapping: Mapping = {};
            let t = assignsTerm;
            while (t && t.indicator === "./2") {
              const node = t.args[0];
              const idTerm = node.args[0];
              const wordTerm = node.args[1];
              const id = parseInt(idTerm.id);
              const word = (wordTerm.id || "").replace(/^'|'+$/g, "");
              mapping[id] = word;
              t = t.args[1];
            }
            resolve(mapping);
          });
        },
        error: () => resolve(null)
      });
    });
  }

  // Solve current UI grid
  const onSolve = async () => {
    setBusy(true);
    setSolved(null);
    setStatus("solving… (Prolog if available, else JS)");
    try {
      const mapping = await solveFor(grid, words);
      if (!mapping) {
        setStatus("no solution found — try opening more cells or adding more words");
        setBusy(false);
        return;
      }
      const slots = computeSlots(grid);
      const filled = grid.map(row => row.map(c => ({ ...c })));
      for (const s of slots) {
        const w = mapping[s.id];
        if (!w) continue;
        for (let k = 0; k < s.len; k++) {
          const rr = s.dir === "H" ? s.r : s.r + k;
          const cc = s.dir === "H" ? s.c + k : s.c;
          filled[rr][cc].ch = w[k];
        }
      }
      setSolved(filled);
      setStatus("solved ✔");
    } catch (e: any) {
      setStatus("error: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // Export to CSV of current grid (letters, blocks as #)
  const toCSV = () => {
    const g = solved ?? grid;
    const rowsCSV: string[] = [];
    for (let r = 0; r < g.length; r++) {
      const row = [] as string[];
      for (let c = 0; c < g[0].length; c++) {
        row.push(g[r][c].blocked ? " " : (g[r][c].ch ?? ""));
      }
      rowsCSV.push(row.join(","));
    }
    const blob = new Blob([rowsCSV.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "crossword.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ------------------------------
  // Import/Export helpers for pattern & words
  // ------------------------------
  function parsePatternText(text: string) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const rowsTokens = lines.map(l => {
      const tokens = l.includes(',') ? l.split(',') : l.split(/\s+/);
      if (tokens.length === 1 && /[01#\.]+/i.test(tokens[0])) return tokens[0].split('');
      return tokens;
    });
    const R = rowsTokens.length;
    const C = Math.max(...rowsTokens.map(r => r.length));
    const g: Cell[][] = make2D(R, C, { blocked: true });
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const tok = (rowsTokens[r][c] ?? '#').toString().trim().toUpperCase();
        // 1=open, 0=blocked; also support . open, # blocked
        const open = tok === '1' || tok === '.';
        g[r][c] = { blocked: !open };
      }
    }
    return { R, C, g };
  }

  const onImportPattern: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parsePatternText(text);
    if (!parsed) { setStatus('pattern file empty or invalid'); return; }
    setRows(parsed.R); setCols(parsed.C); setSolved(null);
    setGrid(parsed.g);
    setStatus(`pattern loaded (${parsed.R}x${parsed.C})`);
    setPatternInfo(`${file.name} • ${parsed.R}×${parsed.C}`);
    e.target.value = '';
  };

  const onImportWords: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    // normalize CRLF/CR to \n and update UI info
    setWordsText(text.replace(/\r?\n/g, '\n'));
    const count = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).length;
    setStatus('words loaded from file');
    setWordsInfo(`${file.name} • ${count} line${count === 1 ? '' : 's'}`);
    e.target.value = '';
  };

  const exportPattern = () => {
    const g = solved ?? grid;
    const lines: string[] = [];
    for (let r = 0; r < g.length; r++) {
      const row: string[] = [];
      for (let c = 0; c < g[0].length; c++) {
        // export 1 for open, 0 for blocked
        row.push(g[r][c].blocked ? '0' : '1');
      }
      lines.push(row.join(''));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'binpattern.txt'; a.click();
    URL.revokeObjectURL(url);
  };

  const exportWords = () => {
    const blob = new Blob([wordsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'words.txt'; a.click();
    URL.revokeObjectURL(url);
  };

  // ------------------------------
  // Built‑in TESTS (on demand)
  // ------------------------------
  async function runBuiltInTests() {
    const results: string[] = [];

    // Test 1: solvable 3x3 with cross — expect a solution
    const g1 = make2D(3, 3, { blocked: false }) as Cell[][];
    g1[1][0].blocked = true; g1[1][2].blocked = true;
    const w1 = ["CAT", "DOG", "AXO"];
    const sol1 = await solveFor(g1, w1);
    results.push(`Test 1 (solvable): ${sol1 ? 'PASS' : 'FAIL'}`);

    // Test 2: unsolvable variant — expect null
    const w2 = ["CAT", "DOG", "AAA"];
    const sol2 = await solveFor(g1, w2);
    results.push(`Test 2 (unsolvable): ${!sol2 ? 'PASS' : 'FAIL'}`);

    // Test 3: no slots (all blocked) — expect null
    const g2 = make2D(2, 2, { blocked: true }) as Cell[][];
    const sol3 = await solveFor(g2, ["AA"]);
    results.push(`Test 3 (no slots): ${!sol3 ? 'PASS' : 'FAIL'}`);

    // Test 4: simple 1x4 horizontal open — expect a solution
    const g3 = make2D(1, 4, { blocked: false }) as Cell[][];
    const sol4 = await solveFor(g3, ["ABCD", "EFGH"]);
    results.push(`Test 4 (1x4 across): ${sol4 ? 'PASS' : 'FAIL'}`);

    setTestOutput(results.join("\n"));
  }

  const onClearLetters = () => { setSolved(null); setStatus(""); };
  const onResetBlocks = () => {
    setSolved(null);
    setGrid(g => g.map(row => row.map(_ => ({ blocked: true }))));
    setStatus("");
  };

  return (
    <>
      <BackgroundCover />
      <div style={S.page}>
        <div style={S.container}>
          <header style={S.headerRow}>
            <h1 style={S.h1}>Crossword Builder & Solver</h1>
            <div style={S.small}>click cells to toggle blocks • paste words • solve</div>
          </header>

          {/* Controls */}
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <div style={S.card}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Grid Size</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <label style={S.label}>Columns (X)</label>
                <input type="number" min={3} max={30} value={cols} onChange={e => setCols(parseInt(e.target.value || "0"))} style={S.input as any} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <label style={S.label}>Rows (Y)</label>
                <input type="number" min={3} max={30} value={rows} onChange={e => setRows(parseInt(e.target.value || "0"))} style={S.input as any} />
              </div>
              <button onClick={applySize} style={S.btn as any}>Apply Size</button>
              <div style={{ ...S.small, marginTop: 8 }}>new grids start with all cells blocked — click to open           

              </div>
              <div style={{ marginTop: 12 }}>

              <br />
              <div style={S.small}>Import gridpattern.txt (use '1' for open, '0' for blocked )</div>
              <input type="file" accept=".txt,text/plain" onChange={onImportPattern} style={{ display: 'block', marginTop: 4 }} />
              <div style={S.small}>{patternInfo || 'No file selected yet'}</div>
                </div>

            </div>

            <div style={S.card}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Word List</div>
              <textarea
                style={S.textarea as any}
                value={wordsText}
                onChange={e => setWordsText(e.target.value)}
                placeholder={`One word per line (A–Z)
Example:
PYTHON
LINUX
KERNEL`}
              />
              <div style={{ ...S.small, marginTop: 8 }}>non-letters are ignored • words shorter than 2 are dropped</div>
              <div style={{ marginTop: 12 }}>
             <div style={S.small}>Import words.txt (one word per line)</div>
              <input type="file" accept=".txt,text/plain" onChange={onImportWords} style={{ display: 'block', marginTop: 4 }} />
              <div style={S.small}>{wordsInfo || 'No file selected yet'}</div>
              </div>

            </div>

            <div style={S.card}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Actions</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button onClick={onSolve} disabled={busy} style={S.btnPrimary as any}>{busy ? "Solving…" : "Solve"}</button>
                <button onClick={toCSV} style={S.btn as any}>Export CSV</button>
                <button onClick={exportPattern} style={S.btn as any}>Export Pattern</button>
                <button onClick={exportWords} style={S.btn as any}>Export Words</button>
                <button onClick={onClearLetters} style={S.btn as any}>Clear Letters</button>
                <button onClick={onResetBlocks} style={S.btn as any}>Reset Blocks</button>
                <button onClick={runBuiltInTests} style={S.btn as any}>Run Tests</button>
              </div>
              
              <div style={{ ...S.small, marginTop: 8, whiteSpace: 'pre-wrap' }}>{status}</div>
              {testOutput && (
                <div style={{ marginTop: 8, fontSize: 12, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, whiteSpace: 'pre-wrap' }}>
                  {testOutput}
                </div>
              )}
            </div>
          </div>

          {/* Grid */}
          <div style={S.card}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Grid</div>
            <div style={S.gridWrap}>
              <div style={S.grid(cols)}>
                {grid.map((row, r) => row.map((cell, c) => {
                  const letter = solved?.[r]?.[c]?.ch;
                  const isBlocked = cell.blocked;
                  return (
                    <button
                      key={`${r}-${c}`}
                      onClick={() => toggleCell(r, c)}
                      style={S.cell(isBlocked, !!letter) as any}
                      title={`${r + 1},${c + 1}`}
                    >
                      {!isBlocked ? (letter ?? "") : ""}
                    </button>
                  );
                }))}
              </div>
            </div>
            <div style={{ ...S.small, marginTop: 8 }}>black = blocked • white = playable • letters appear after solve</div>
          </div>

          {/* Tips */}
          <div style={S.card}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Tips</div>
            <ul style={{ marginLeft: 18, padding: 0, listStyle: 'disc' }}>
              <li style={S.tipsLi}>open slots of length ≥ 2 for valid clues</li>
              <li style={S.tipsLi}>if no solution, add more words or change the pattern</li>
              <li style={S.tipsLi}>Prolog engine loads from CDN; if blocked, app falls back to JS solver</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
