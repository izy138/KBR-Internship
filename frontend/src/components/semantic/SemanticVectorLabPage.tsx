import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  type HybridSearchResponse,
  type SearchResultRecord,
  searchHybrid,
} from "../../api";
import { formatDollarsFull } from "../../utils/format";

const DEFAULT_K = 12;

const CLS_PANEL =
  "bg-surface border border-border rounded-lg px-[1.35rem] pt-[1.25rem] pb-[1.4rem] shadow-sm";
const CLS_H2 = "text-[0.95rem] font-semibold text-text-primary mb-[0.4rem]";
const CLS_DESC = "mb-4 text-[0.875rem] leading-[1.5] text-text-secondary";
const CLS_INLINE_CODE =
  "font-mono text-[0.78rem] bg-tag-bg text-tag-text px-[0.35rem] py-[0.12rem] rounded-sm";
const CLS_FORM = "flex flex-col gap-2";
const CLS_LABEL = "text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-muted";
const CLS_ROW = "flex flex-wrap gap-[0.6rem] items-center";
const CLS_INPUT =
  "flex-1 min-w-[180px] px-[0.75rem] py-[0.55rem] border border-border rounded-sm bg-bg text-text-primary font-sans text-[0.9375rem]";
const CLS_TEXTAREA =
  "w-full px-[0.75rem] py-[0.6rem] border border-border rounded-sm bg-bg text-text-primary font-sans text-[0.9375rem] leading-[1.45] resize-y";
const CLS_BTN =
  "px-4 py-[0.55rem] border-none rounded-sm bg-accent text-white font-sans text-[0.9rem] font-medium cursor-pointer hover:brightness-105 disabled:opacity-65 disabled:cursor-not-allowed";
const CLS_ERROR = "mt-2 text-[0.875rem] text-[#b91c1c] dark:text-[#fca5a5]";
const CLS_META = "mt-3 mb-[0.35rem] text-[0.8125rem] text-text-muted";
const CLS_HIT_TITLE = "text-[0.9375rem] font-medium text-text-primary leading-[1.35] mb-[0.35rem]";
const CLS_HIT_META = "flex flex-wrap gap-[0.35rem_0.5rem] items-center text-[0.78rem] text-text-secondary";
const CLS_RANKED_ITEM = "border border-border rounded-md p-[0.85rem_1rem] mb-2 bg-bg";
const CLS_RANK_BADGE =
  "inline-flex items-center justify-center min-w-[1.65rem] h-[1.65rem] rounded-sm bg-accent-light text-accent-text text-[0.75rem] font-semibold";
const CLS_LINKISH =
  "p-0 border-none bg-transparent text-accent font-[inherit] text-[0.8125rem] font-medium cursor-pointer underline underline-offset-2 hover:text-accent-text";
const CLS_TAG_ACTIVITY =
  "inline-block px-[0.42rem] py-[0.12rem] rounded-full text-[0.72rem] font-semibold leading-[1.3] bg-accent-light text-accent-text";
const CLS_TAG_FY =
  "inline-block px-[0.42rem] py-[0.12rem] rounded-full text-[0.72rem] font-semibold leading-[1.3] bg-green-light text-green";

function ResultSnippet({ item }: { item: SearchResultRecord }): JSX.Element {
  const id = item._id ?? item.id ?? "";
  const title = item.PROJECT_TITLE ?? "Untitled";
  return (
    <div className="min-w-0">
      <div className={CLS_HIT_TITLE}>{title}</div>
      <div className={CLS_HIT_META}>
        {item.ACTIVITY ? <span className={CLS_TAG_ACTIVITY}>{item.ACTIVITY}</span> : null}
        {item.FY != null ? <span className={CLS_TAG_FY}>FY {item.FY}</span> : null}
        {item.IC_NAME ? <span className="text-text-muted">{item.IC_NAME}</span> : null}
      </div>
      {id ? (
        <code className="block mt-[0.35rem] text-[0.7rem] text-text-muted break-all">{id}</code>
      ) : null}
    </div>
  );
}

export default function SemanticVectorLabPage(): JSX.Element {
  const navigate = useNavigate();

  const [hybridQ, setHybridQ] = useState("CRISPR base editing cardiovascular disease");
  const [hybridKInput, setHybridKInput] = useState(String(DEFAULT_K));
  const [hybridActivity, setHybridActivity] = useState("");
  const [hybridState, setHybridState] = useState("");
  const [hybridFyMin, setHybridFyMin] = useState("");
  const [hybridFyMax, setHybridFyMax] = useState("");
  const [hybridLoading, setHybridLoading] = useState(false);
  const [hybridResult, setHybridResult] = useState<HybridSearchResponse | null>(null);
  const [hybridError, setHybridError] = useState("");

  const goSimilarPage = (projectId: string) => {
    navigate(`/semantic/similar/${encodeURIComponent(projectId)}`);
  };

  const handleHybridSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setHybridError("");
    setHybridResult(null);
    const q = hybridQ.trim();
    if (!q) {
      setHybridError("Enter a query.");
      return;
    }
    const kParsed = Number.parseInt(hybridKInput.trim(), 10);
    const k =
      Number.isFinite(kParsed) && kParsed >= 1 && kParsed <= 50 ? kParsed : DEFAULT_K;
    if (k !== kParsed) {
      setHybridKInput(String(k));
    }

    setHybridLoading(true);
    try {
      const payload = await searchHybrid(q, {
        k,
        activity: hybridActivity.trim(),
        state: hybridState.trim(),
        fyMin: hybridFyMin.trim(),
        fyMax: hybridFyMax.trim(),
      });
      setHybridResult(payload);
    } catch (err) {
      setHybridError(err instanceof Error ? err.message : "Hybrid search failed.");
    } finally {
      setHybridLoading(false);
    }
  };

  return (
    <div className="max-w-[880px] mx-auto px-0 pt-2 pb-10">
      <section className={CLS_PANEL} aria-labelledby="hybrid-heading">
        <h2 id="hybrid-heading" className={CLS_H2}>
          3 — Hybrid keyword + vectors (RRF)
        </h2>
        <p className={CLS_DESC}>
          Runs BM25 and k-NN in parallel, then merges rankings with reciprocal rank fusion (
          <code className={CLS_INLINE_CODE}>GET /search/hybrid</code>
          ). Optional filters apply to <em>both</em> sides. Each hit shows fused score and its rank
          on each list when present.
        </p>
        <form className={CLS_FORM} onSubmit={handleHybridSubmit}>
          <label className={CLS_LABEL} htmlFor="hybrid-q">
            Query
          </label>
          <textarea
            id="hybrid-q"
            className={CLS_TEXTAREA}
            rows={2}
            value={hybridQ}
            onChange={(e) => setHybridQ(e.target.value)}
          />
          <div className="grid grid-cols-1 gap-2 min-[901px]:grid-cols-[140px_1fr] min-[901px]:gap-x-3 min-[901px]:gap-y-[0.45rem] min-[901px]:items-center mb-[0.35rem]">
            <label className={CLS_LABEL} htmlFor="hybrid-act">
              Activity (optional)
            </label>
            <input
              id="hybrid-act"
              className={CLS_INPUT}
              value={hybridActivity}
              onChange={(e) => setHybridActivity(e.target.value)}
              placeholder="e.g. R01"
            />
            <label className={CLS_LABEL} htmlFor="hybrid-st">
              State (optional)
            </label>
            <input
              id="hybrid-st"
              className={CLS_INPUT}
              value={hybridState}
              onChange={(e) => setHybridState(e.target.value)}
              placeholder="e.g. CA"
            />
            <label className={CLS_LABEL} htmlFor="hybrid-fymin">
              FY min
            </label>
            <input
              id="hybrid-fymin"
              className={CLS_INPUT}
              value={hybridFyMin}
              onChange={(e) => setHybridFyMin(e.target.value)}
              placeholder="2020"
            />
            <label className={CLS_LABEL} htmlFor="hybrid-fymax">
              FY max
            </label>
            <input
              id="hybrid-fymax"
              className={CLS_INPUT}
              value={hybridFyMax}
              onChange={(e) => setHybridFyMax(e.target.value)}
              placeholder="2025"
            />
          </div>
          <div className={`${CLS_ROW} justify-end mt-[0.35rem]`}>
            <label className="inline-flex items-center gap-[0.4rem]">
              <span className="text-[0.8125rem] text-text-secondary">k</span>
              <input
                id="hybrid-k"
                type="text"
                inputMode="numeric"
                className={`${CLS_INPUT} flex-[0_0_auto] min-w-[4.5rem] max-w-[5.5rem]`}
                value={hybridKInput}
                onChange={(e) => setHybridKInput(e.target.value.replace(/[^\d]/g, ""))}
                aria-label="Number of results"
              />
            </label>
            <button type="submit" className={CLS_BTN} disabled={hybridLoading}>
              {hybridLoading ? "Running hybrid…" : "Run hybrid search"}
            </button>
          </div>
        </form>
        {hybridError ? <p className={CLS_ERROR}>{hybridError}</p> : null}
        {hybridResult ? (
          <div className="mt-2">
            <p className={CLS_META}>
              BM25 total ≈ <strong>{hybridResult.keyword_total.toLocaleString()}</strong> · fetched{" "}
              {hybridResult.fetch_size_per_side} per side · returning top{" "}
              <strong>{hybridResult.results.length}</strong> fused
            </p>
            <ol className="list-none m-0 p-0">
              {hybridResult.results.map((item, index) => {
                const id = item._id ?? item.id ?? "";
                const fused =
                  typeof item._score === "number" ? item._score : Number(item._score) || null;
                const rk = item._rank_keyword;
                const rv = item._rank_vector;
                return (
                  <li key={id || String(index)} className={CLS_RANKED_ITEM}>
                    <div className="flex flex-wrap items-center gap-[0.5rem_0.75rem] mb-2">
                      <span className={CLS_RANK_BADGE}>{index + 1}</span>
                      {fused != null ? (
                        <span
                          className="font-mono text-[0.75rem] text-text-secondary"
                          title="RRF fused score"
                        >
                          RRF {fused.toFixed(5)}
                        </span>
                      ) : null}
                      <span className="text-[0.72rem] text-text-muted">
                        BM25 rank: {rk != null ? String(rk) : "—"} · Vector rank:{" "}
                        {rv != null ? String(rv) : "—"}
                      </span>
                    </div>
                    <ResultSnippet item={item} />
                    <div className={`${CLS_HIT_META} mt-[0.35rem] font-mono text-[0.8125rem]`}>
                      {formatDollarsFull(item.TOTAL_COST)}
                    </div>
                    {id ? (
                      <div className="flex flex-wrap gap-[0.75rem_1rem] mt-[0.65rem]">
                        <button
                          type="button"
                          className={CLS_LINKISH}
                          onClick={() => navigate(`/projects/${encodeURIComponent(id)}`)}
                        >
                          Full project
                        </button>
                        <button
                          type="button"
                          className={CLS_LINKISH}
                          onClick={() => goSimilarPage(id)}
                        >
                          Similar to this grant
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </section>
    </div>
  );
}
