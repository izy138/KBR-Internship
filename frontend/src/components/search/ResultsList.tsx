import { type AriaAttributes, type FC, Fragment, useState, useCallback, useMemo } from "react";
import type { SearchResultRecord } from "../../api";
import { getOrderedPiNames } from "../../utils/piNames";
import { formatDollarsCompact } from "../../utils/format";
import { cn } from "../../utils/cn";
// ─── Types ────────────────────────────────────────────────────────────────────

export type ColumnKey =
  | "PI_NAMEs"
  | "ORG_NAME"
  | "IC_NAME"
  | "ORG_STATE"
  | "ACTIVITY"
  | "FY"
  | "TOTAL_COST";

export type SortDirection = "asc" | "desc" | "none";

export interface SortState {
  column: ColumnKey | null;
  direction: SortDirection;
}

type DisplayColumnKey = ColumnKey | "_score";

type ResultsListProps = {
  results: SearchResultRecord[];
  primarySort: "relevant" | "alphaAsc" | "alphaDesc";
  loading?: boolean;
  /** k-NN cosine score column immediately before Principal Investigator. */
  showSimilarityScore?: boolean;
  onOpenDetails?: (item: SearchResultRecord) => void;
  onOpenInvestigator?: (name: string) => void;
  onOpenOrganization?: (name: string) => void;
  onOpenInstitution?: (name: string) => void;
  /**
   * Controlled sort. When provided together with `onSortChange`, the parent
   * owns the sort state and is expected to fetch already-sorted results from
   * the API. Without these props, `ResultsList` falls back to its legacy
   * client-side sort over the rows currently in `results` (used by views
   * where all results are loaded at once, e.g. the semantic similar page).
   */
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
};

interface ColumnDef {
  key: ColumnKey;
  label: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMNS: ColumnDef[] = [
  { key: "PI_NAMEs",      label: "Principal Investigator"        },
  { key: "IC_NAME",       label: "Institution"   },
  { key: "ORG_NAME",      label: "Organization"  },
  { key: "ORG_STATE",     label: "State"         },
  { key: "ACTIVITY",      label: "Code"          },
  { key: "FY",            label: "FY"            },
  { key: "TOTAL_COST",    label: "Total Cost"    },
];

const SIMILARITY_COLUMN: { key: DisplayColumnKey; label: string } = {
  key: "_score",
  label: "Similarity",
};

function getDisplayColumns(showSimilarityScore: boolean): Array<{ key: DisplayColumnKey; label: string }> {
  if (!showSimilarityScore) {
    return COLUMNS;
  }
  const [pi, ...rest] = COLUMNS;
  return [SIMILARITY_COLUMN, pi, ...rest];
}

function getColsGridClass(showSimilarityScore: boolean): string {
  return showSimilarityScore
    ? "grid grid-cols-[8%_17%_26%_21%_5%_5%_3%_10%] gap-x-4 items-center"
    : "grid grid-cols-[20%_28%_23%_5%_5%_3%_10%] gap-x-4 items-center";
}

function columnNegMargin(colKey: DisplayColumnKey): string {
  if (colKey === "ORG_STATE") return "-ml-8";
  if (colKey === "ACTIVITY") return "-ml-12";
  if (colKey === "FY") return "-ml-10";
  return "";
}

function formatSimilarityScore(score: unknown): string {
  if (typeof score === "number" && Number.isFinite(score)) {
    return score.toFixed(4);
  }
  const parsed = Number(score);
  return Number.isFinite(parsed) ? parsed.toFixed(4) : "—";
}

const CLS_TH_BASE =
  "inline-flex w-fit max-w-full justify-self-start items-center gap-1 bg-transparent border-none px-[0.2rem] py-[0.24rem] cursor-pointer font-sans text-[10px] font-semibold tracking-[0.06em] uppercase rounded-sm transition-[color,background] duration-150 whitespace-nowrap hover:bg-accent-light focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1";

const CLS_CELL_VALUE_BASE = "block text-[12px] text-text-secondary whitespace-nowrap overflow-hidden text-ellipsis leading-[1.3]";

const CLS_CELL_LINK_BTN =
  "p-0 border-none bg-transparent text-accent-text font-[inherit] cursor-pointer hover:underline max-w-full truncate inline-block align-bottom group-hover:text-accent-hover";

function LinkableCellValue({
  value,
  onActivate,
}: {
  value: string;
  onActivate?: (value: string) => void;
}) {
  if (value === "—" || !onActivate) {
    return <span className={CLS_CELL_VALUE_BASE}>{value}</span>;
  }
  return (
    <span className={CLS_CELL_VALUE_BASE}>
      <button
        type="button"
        className={CLS_CELL_LINK_BTN}
        onClick={(event) => {
          event.stopPropagation();
          onActivate(value);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
      >
        {value}
      </button>
    </span>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSortValue(item: SearchResultRecord, column: DisplayColumnKey): string | number {
  if (column === "_score") {
    const score = item._score;
    if (typeof score === "number" && Number.isFinite(score)) return score;
    const parsed = Number(score);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }
  const raw = item[column];
  if (raw == null) return "";
  if (column === "TOTAL_COST") {
    if (typeof raw === "number") return raw;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }
  if (typeof raw === "number") return raw;
  return String(raw).toLowerCase();
}

function cycleSortDirection(current: SortDirection): SortDirection {
  if (current === "none") return "asc";
  if (current === "asc") return "desc";
  return "none";
}

function applyPrimarySort(
  results: SearchResultRecord[],
  primarySort: ResultsListProps["primarySort"],
): SearchResultRecord[] {
  if (primarySort === "relevant") {
    // Keep API order for relevance ranking.
    return results;
  }

  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const getTitle = (record: SearchResultRecord): string =>
    record.PROJECT_TITLE ?? record.project_title ?? record.title ?? "";
  return [...results].sort((a, b) => {
    if (primarySort === "alphaAsc") return collator.compare(getTitle(a), getTitle(b));
    return collator.compare(getTitle(b), getTitle(a));
  });
}

const ChevronIcon: FC<{ direction: SortDirection }> = ({ direction }) => {
  if (direction === "asc") {
    return (
      <svg
        className="shrink-0 transition-[color] duration-150 text-accent-hover"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M2 7L5 3L8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  if (direction === "desc") {
    return (
      <svg
        className="shrink-0 transition-[color] duration-150 text-sort-desc"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M2 3L5 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  return (
    <svg
      className="shrink-0 transition-[color] duration-150 text-accent-text opacity-60"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 6.5L5 4L8 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M2 7.5L5 5L8 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.4" />
    </svg>
  );
};

type ListSortState = {
  column: DisplayColumnKey | null;
  direction: SortDirection;
};

interface SortHeaderProps {
  columns: Array<{ key: DisplayColumnKey; label: string }>;
  colsGridClass: string;
  sort: ListSortState;
  onSort: (column: DisplayColumnKey) => void;
}

// ─── Sticky Header ────────────────────────────────────────────────────────────

const ResultsHeader: FC<SortHeaderProps> = ({ columns, colsGridClass, sort, onSort }) => (
  <div
    className={`sticky top-0 z-10 bg-surface-hover border-b-2 border-border-strong px-[1.25rem] py-[0.36rem] ${colsGridClass}`}
    role="row"
  >
    <div className="contents">
      {columns.map((col) => {
        const isActive = sort.column === col.key && sort.direction !== "none";
        const currentDirection: SortDirection = sort.column === col.key ? sort.direction : "none";
        const ariaSort: AriaAttributes["aria-sort"] =
          sort.column === col.key
            ? sort.direction === "asc"
              ? "ascending"
              : sort.direction === "desc"
              ? "descending"
              : "none"
            : "none";

        const negMargin = columnNegMargin(col.key);

        const thClass = cn(
          CLS_TH_BASE,
          negMargin,
          isActive && "font-bold",
          !isActive && "text-accent-text hover:text-accent-hover",
        );

        const labelClass = cn(
          "overflow-hidden text-ellipsis whitespace-nowrap text-[12px]",
          currentDirection === "asc" && "text-accent-hover",
          currentDirection === "desc" && "text-sort-desc",
        );

        return (
          <Fragment key={col.key}>
            <button
              type="button"
              className={thClass}
              role="columnheader"
              aria-sort={ariaSort}
              onClick={() => onSort(col.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSort(col.key);
                }
              }}
            >
              <span className={labelClass}>{col.label}</span>
              <ChevronIcon direction={currentDirection} />
            </button>
          </Fragment>
        );
      })}
    </div>
  </div>
);

// ─── Skeleton Row ─────────────────────────────────────────────────────────────

const SkeletonRow: FC<{
  columns: Array<{ key: DisplayColumnKey; label: string }>;
  colsGridClass: string;
}> = ({ columns, colsGridClass }) => (
  <div
    className="bg-surface px-[1.25rem] py-[0.4rem] cursor-default pointer-events-none border-b border-border last:border-b-0"
    aria-hidden="true"
  >
    <div className={`mt-[0.6rem] ${colsGridClass}`}>
      {columns.map((col) => (
        <div key={col.key} className="overflow-hidden">
          <div className="skeleton-line" style={{ width: col.key === "_score" ? "55%" : "70%" }} />
        </div>
      ))}
    </div>
    <div className="flex items-baseline justify-between gap-4">
      <div className="skeleton-line" style={{ width: "55%" }} />
      <div className="skeleton-line" style={{ width: "12%", marginLeft: "auto" }} />
    </div>
  </div>
);

// ─── Mobile Card ──────────────────────────────────────────────────────────────

interface MobileResultCardProps {
  item: SearchResultRecord;
  showSimilarityScore: boolean;
  onOpenDetails?: (item: SearchResultRecord) => void;
  onOpenInvestigator?: (name: string) => void;
  onOpenOrganization?: (name: string) => void;
  onOpenInstitution?: (name: string) => void;
}

const MobileResultCard: FC<MobileResultCardProps> = ({
  item,
  showSimilarityScore,
  onOpenDetails,
  onOpenInvestigator,
  onOpenOrganization,
  onOpenInstitution,
}) => {
  const title =
    item.PROJECT_TITLE ?? item.title ?? item.project_title ?? "Untitled Project";
  const totalCost = item.TOTAL_COST;
  const orderedPiNames = getOrderedPiNames(item.PI_NAMEs);
  const orgName = item.ORG_NAME ?? "—";
  const icName = item.IC_NAME ?? "—";
  const state = item.ORG_STATE ?? "—";
  const activity = item.ACTIVITY ?? "—";
  const fy = item.FY != null ? String(item.FY) : "—";
  const costDisplay =
    totalCost != null && !Number.isNaN(totalCost) ? formatDollarsCompact(totalCost) : "—";

  const handleActivate = useCallback(() => {
    onOpenDetails?.(item);
  }, [item, onOpenDetails]);

  return (
    <div
      className="group bg-surface px-3 py-3 cursor-pointer transition-[background] duration-100 border-b border-border last:border-b-0 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px]"
      role="row"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate();
        }
      }}
      aria-label={`Project: ${title}`}
    >
      <h3 className="text-[14px] font-semibold text-text-primary leading-[1.4] line-clamp-2 mb-1.5 group-hover:text-accent-hover">
        {title}
      </h3>

      {showSimilarityScore ? (
        <div className="mb-1.5 font-mono text-[11px] tabular-nums text-text-muted">
          Similarity: {formatSimilarityScore(item._score)}
        </div>
      ) : null}

      <div className="flex flex-nowrap items-center gap-x-2 overflow-x-auto text-[11px] text-text-secondary leading-[1.35] min-w-0">
        <div className="inline-flex min-w-0 max-w-full items-center gap-1">
          <span className="shrink-0 text-text-muted text-[9px] uppercase tracking-wide font-semibold">
            PI
          </span>
          <span className="min-w-0 truncate">
            {orderedPiNames.length > 0 ? (
              onOpenInvestigator ? (
                orderedPiNames.map((name, index) => (
                  <Fragment key={name}>
                    <button
                      type="button"
                      className={CLS_CELL_LINK_BTN}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenInvestigator(name);
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                      }}
                    >
                      {name}
                    </button>
                    {index < orderedPiNames.length - 1 ? "; " : ""}
                  </Fragment>
                ))
              ) : (
                orderedPiNames.join("; ")
              )
            ) : (
              "—"
            )}
          </span>
        </div>
        <span className="shrink-0 text-border-strong" aria-hidden>
          ·
        </span>
        <div className="inline-flex min-w-0 max-w-[38%] items-center gap-1">
          <span className="shrink-0 text-text-muted text-[9px] uppercase tracking-wide font-semibold">
            Org
          </span>
          <LinkableCellValue value={orgName} onActivate={onOpenOrganization} />
        </div>
        <span className="shrink-0 text-border-strong" aria-hidden>
          ·
        </span>
        <div className="inline-flex min-w-0 max-w-[38%] items-center gap-1">
          <span className="shrink-0 text-text-muted text-[9px] uppercase tracking-wide font-semibold">
            Inst
          </span>
          <LinkableCellValue value={icName} onActivate={onOpenInstitution} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {state !== "—" ? (
          <span className="text-[11px] text-text-secondary">{state}</span>
        ) : null}
        {activity !== "—" ? (
          <span className="inline-block bg-accent-light text-accent-text rounded-full px-[0.42rem] py-[0.12rem] text-[10px] font-medium">
            {activity}
          </span>
        ) : null}
        {fy !== "—" ? (
          <span className="inline-block bg-green-light text-green rounded-full px-[0.42rem] py-[0.12rem] text-[10px] font-medium">
            {fy}
          </span>
        ) : null}
        <span className="ml-auto font-medium text-[12px] text-text-primary shrink-0">
          {costDisplay}
        </span>
      </div>
    </div>
  );
};

const MobileSkeletonCard: FC = () => (
  <div
    className="bg-surface px-3 py-3 border-b border-border last:border-b-0 pointer-events-none"
    aria-hidden="true"
  >
    <div className="skeleton-line mb-2" style={{ width: "85%" }} />
    <div className="skeleton-line mb-1.5" style={{ width: "60%" }} />
    <div className="skeleton-line mb-1.5" style={{ width: "70%" }} />
    <div className="flex gap-2 mt-2">
      <div className="skeleton-line" style={{ width: "18%" }} />
      <div className="skeleton-line" style={{ width: "22%" }} />
      <div className="skeleton-line ml-auto" style={{ width: "25%" }} />
    </div>
  </div>
);

// ─── Result Row ───────────────────────────────────────────────────────────────

interface ResultRowProps {
  columns: Array<{ key: DisplayColumnKey; label: string }>;
  colsGridClass: string;
  item: SearchResultRecord;
  onOpenDetails?: (item: SearchResultRecord) => void;
  onOpenInvestigator?: (name: string) => void;
  onOpenOrganization?: (name: string) => void;
  onOpenInstitution?: (name: string) => void;
}

const ResultRow: FC<ResultRowProps> = ({
  columns,
  colsGridClass,
  item,
  onOpenDetails,
  onOpenInvestigator,
  onOpenOrganization,
  onOpenInstitution,
}) => {
  const title =
    item.PROJECT_TITLE ?? item.title ?? item.project_title ?? "Untitled Project";
  const totalCost = item.TOTAL_COST;
  const orderedPiNames = getOrderedPiNames(item.PI_NAMEs);

  const cellValues: Record<ColumnKey, string> = {
    PI_NAMEs:      item.PI_NAMEs ?? "—",
    ORG_NAME:      item.ORG_NAME      ?? "—",
    IC_NAME:       item.IC_NAME       ?? "—",
    ORG_STATE:     item.ORG_STATE     ?? "—",
    ACTIVITY:      item.ACTIVITY      ?? "—",
    FY:            item.FY != null    ? String(item.FY) : "—",
    TOTAL_COST:    totalCost != null && !Number.isNaN(totalCost) ? formatDollarsCompact(totalCost) : "—",
  };

  const handleActivate = useCallback(() => {
    onOpenDetails?.(item);
  }, [item, onOpenDetails]);

  return (
    <div
      className="group bg-surface px-[1.25rem] py-[0.4rem] cursor-pointer transition-[background] duration-100 border-b border-border last:border-b-0 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px]"
      role="row"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate();
        }
      }}
      aria-label={`Project: ${title}`}
    >
      {/* First line: title */}
      <div className="flex items-baseline justify-between gap-4" role="presentation">
        <h3 className="flex-1 min-w-0 text-[14.5px] font-semibold text-text-primary leading-[1.4] whitespace-nowrap overflow-hidden text-ellipsis mb-0 mt-[0.45rem] group-hover:text-accent-hover">
          {title}
        </h3>
      </div>

      {/* Second line: column-aligned metadata strip */}
      <div className={`mt-[0.6rem] ${colsGridClass}`} role="presentation">
        {columns.map((col) => {
          const negMargin = columnNegMargin(col.key);

          return (
            <div key={col.key} className={`overflow-hidden ${negMargin}`} role="cell">
              {col.key === "_score" ? (
                <span
                  className={cn(CLS_CELL_VALUE_BASE, "font-mono text-[11px] tabular-nums")}
                  title="OpenSearch k-NN similarity score"
                >
                  {formatSimilarityScore(item._score)}
                </span>
              ) : col.key === "PI_NAMEs" ? (
                <span className={CLS_CELL_VALUE_BASE}>
                  {orderedPiNames.length > 0 ? (
                    onOpenInvestigator ? (
                      orderedPiNames.map((name, index) => (
                        <Fragment key={name}>
                          <button
                            type="button"
                            className={CLS_CELL_LINK_BTN}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenInvestigator(name);
                            }}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            {name}
                          </button>
                          {index < orderedPiNames.length - 1 ? "; " : ""}
                        </Fragment>
                      ))
                    ) : (
                      orderedPiNames.join("; ")
                    )
                  ) : (
                    "—"
                  )}
                </span>
              ) : col.key === "ORG_NAME" ? (
                <LinkableCellValue
                  value={cellValues.ORG_NAME}
                  onActivate={onOpenOrganization}
                />
              ) : col.key === "IC_NAME" ? (
                <LinkableCellValue
                  value={cellValues.IC_NAME}
                  onActivate={onOpenInstitution}
                />
              ) : col.key === "ACTIVITY" ? (
                <span className="inline-block bg-accent-light text-accent-text rounded-full px-[0.42rem] py-[0.12rem] text-[10px] font-medium tracking-[0.01em]">
                  {cellValues.ACTIVITY}
                </span>
              ) : col.key === "FY" ? (
                <span className="inline-block bg-green-light text-green rounded-full px-[0.42rem] py-[0.12rem] text-[10px] font-medium">
                  {cellValues.FY}
                </span>
              ) : col.key === "TOTAL_COST" || col.key === "ORG_STATE" ? (
                <span className={CLS_CELL_VALUE_BASE}>
                  {cellValues[col.key]}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const ResultsList: FC<ResultsListProps> = ({
  results,
  primarySort,
  loading,
  showSimilarityScore = false,
  onOpenDetails,
  onOpenInvestigator,
  onOpenOrganization,
  onOpenInstitution,
  sort: controlledSort,
  onSortChange,
}) => {
  const displayColumns = useMemo(
    () => getDisplayColumns(showSimilarityScore),
    [showSimilarityScore],
  );
  const colsGridClass = getColsGridClass(showSimilarityScore);

  const isControlled = controlledSort !== undefined && onSortChange !== undefined;
  const [internalSort, setInternalSort] = useState<ListSortState>({ column: null, direction: "none" });
  const sort: ListSortState = isControlled
    ? { column: controlledSort.column, direction: controlledSort.direction }
    : internalSort;

  const handleSort = useCallback(
    (column: DisplayColumnKey) => {
      const nextSort: ListSortState = (() => {
        if (sort.column !== column) {
          return { column, direction: "asc" };
        }
        const nextDirection = cycleSortDirection(sort.direction);
        return {
          column: nextDirection === "none" ? null : column,
          direction: nextDirection,
        };
      })();

      if (isControlled) {
        if (column === "_score") return;
        onSortChange({
          column: nextSort.column as ColumnKey | null,
          direction: nextSort.direction,
        });
      } else {
        setInternalSort(nextSort);
      }
    },
    [sort, isControlled, onSortChange],
  );

  const sortedResults = useMemo<SearchResultRecord[]>(() => {
    // Controlled mode: API sorts column clicks; primary dropdown still applies
    // when no column is active (relevance keeps API score order).
    if (isControlled) {
      if (sort.column === null || sort.direction === "none") {
        return applyPrimarySort(results, primarySort);
      }
      return results;
    }
    const baseResults = applyPrimarySort(results, primarySort);
    if (sort.column === null || sort.direction === "none") return baseResults;
    const col = sort.column;
    const dir = sort.direction;
    return [...baseResults].sort((a, b) => {
      const av = getSortValue(a, col);
      const bv = getSortValue(b, col);
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [isControlled, results, primarySort, sort]);

  if (loading) {
    return (
      <>
        <div
          className="hidden min-[901px]:flex flex-col gap-px bg-border border border-border rounded-lg overflow-hidden"
          role="table"
          aria-label="Search results loading"
          aria-busy="true"
        >
          <ResultsHeader
            columns={displayColumns}
            colsGridClass={colsGridClass}
            sort={sort}
            onSort={handleSort}
          />
          <div role="rowgroup">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} columns={displayColumns} colsGridClass={colsGridClass} />
            ))}
          </div>
        </div>
        <div
          className="flex min-[901px]:hidden flex-col bg-border border border-border rounded-lg overflow-hidden"
          aria-label="Search results loading"
          aria-busy="true"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <MobileSkeletonCard key={i} />
          ))}
        </div>
      </>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-12 text-center text-text-muted text-[0.92rem]">
        <svg
          width="40"
          height="40"
          viewBox="0 0 40 40"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="block mx-auto mb-3 text-text-muted"
          aria-hidden="true"
        >
          <circle cx="18" cy="18" r="11" />
          <path d="M27 27L35 35" strokeLinecap="round" />
          <path d="M13 18h10M18 13v10" strokeLinecap="round" />
        </svg>
        <strong className="text-text-secondary text-[15px]">No results found</strong>
        <p>Try adjusting your search terms or filters.</p>
      </div>
    );
  }

  return (
    <>
      <div
        className="hidden min-[901px]:flex flex-col gap-px bg-border border border-border rounded-lg overflow-hidden"
        role="table"
        aria-label="Search results"
        aria-rowcount={results.length}
      >
        <ResultsHeader
          columns={displayColumns}
          colsGridClass={colsGridClass}
          sort={sort}
          onSort={handleSort}
        />
        <div role="rowgroup">
          {sortedResults.map((item, index) => (
            <ResultRow
              key={item._id ?? String(index)}
              columns={displayColumns}
              colsGridClass={colsGridClass}
              item={item}
              onOpenDetails={onOpenDetails}
              onOpenInvestigator={onOpenInvestigator}
              onOpenOrganization={onOpenOrganization}
              onOpenInstitution={onOpenInstitution}
            />
          ))}
        </div>
      </div>
      <div
        className="flex min-[901px]:hidden flex-col bg-border border border-border rounded-lg overflow-hidden"
        role="list"
        aria-label="Search results"
      >
        {sortedResults.map((item, index) => (
          <MobileResultCard
            key={item._id ?? String(index)}
            item={item}
            showSimilarityScore={showSimilarityScore}
            onOpenDetails={onOpenDetails}
            onOpenInvestigator={onOpenInvestigator}
            onOpenOrganization={onOpenOrganization}
            onOpenInstitution={onOpenInstitution}
          />
        ))}
      </div>
    </>
  );
};

export default ResultsList;
