import type { JSX, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProjectFiscalYear, ProjectYearVariant, SearchResultRecord } from "../../api";
import { getProjectOtherYears } from "../../api";
import { getOrderedPiNames } from "../../utils/piNames";
import { groupSimilarNeighbors } from "../../utils/recurrenceGrouping";
import { formatDollarsFull } from "../../utils/format";
import { formatAllCapsLabel, formatDropdownLabel } from "../../utils/filterLabels";
import { cn } from "../../utils/cn";
const CLS_LINK_BTN = "p-0 border-none bg-transparent text-accent font-sans text-[0.8125rem] font-semibold cursor-pointer hover:underline";
import FiscalYearTag from "./FiscalYearTag";
import ProjectActivityTermsChart from "./ProjectActivityTermsChart";
import ProjectSimilarProjectsChart from "./ProjectSimilarProjectsChart";
import SimilarProjectYearTags from "./SimilarProjectYearTags";
import BackToResultsButton from "../shared/BackToResultsButton";
import HelpTooltip from "../shared/HelpTooltip";
import { HELP_PROJECT_KEYWORDS, HELP_PROJECT_SIMILAR } from "../../utils/helpContent";

type TermFilterMode = "include" | "exclude";

const PROJECT_TERMS_INITIAL_VISIBLE = 30;

type ProjectSearchTermsPayload = {
  terms: string[];
  excludedTerms: string[];
  additionalQuery: string;
};

type ProjectDetailsPageProps = {
  item: SearchResultRecord;
  /** True while the full project document is still loading (sidebar can still render). */
  projectContentLoading?: boolean;
  similarNeighbors: SearchResultRecord[];
  similarLoading: boolean;
  similarError: string;
  onBack: () => void;
  onOpenInvestigator?: (name: string) => void;
  onOpenOrganization?: (name: string) => void;
  onOpenInstitution?: (name: string) => void;
  onOpenDetails?: (item: SearchResultRecord) => void;
  onSearchWithProjectTerms?: (payload: ProjectSearchTermsPayload) => void;
};

const ABSTRACT_PREVIEW_LENGTH = 1500;

const CLS_SECTION_H2 = "text-[0.86rem] uppercase tracking-[0.05em] text-text-secondary mb-[0.35rem]";
const CLS_DETAIL_LINK_BTN =
  "p-0 border-none bg-transparent text-accent font-[inherit] text-left cursor-pointer hover:underline";
const CLS_METADATA_ROW = "grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4";
const CLS_METADATA_ROW_TWO = "grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4";

function DetailLinkValue({
  value,
  onActivate,
}: {
  value: string | undefined;
  onActivate?: (name: string) => void;
}) {
  const label = value?.trim() || "—";
  if (label === "—" || !onActivate) {
    return <p className="text-text-primary">{label}</p>;
  }
  return (
    <p className="text-text-primary m-0">
      <button type="button" className={CLS_DETAIL_LINK_BTN} onClick={() => onActivate(label)}>
        {label}
      </button>
    </p>
  );
}

function KeywordTag({ mode, onClick, children }: {
  mode: TermFilterMode | null;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={mode != null}
      onClick={onClick}
      className={cn(
        "inline-flex items-center px-[0.55rem] py-[0.2rem] rounded-full border text-[0.82rem] leading-[1.2] cursor-pointer font-[inherit] transition-[background,border-color,color] duration-[120ms] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
        mode === "include" && "border-accent bg-accent-light text-accent-text",
        mode === "exclude" &&
          "border-red-200/90 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/45 dark:text-red-300",
        mode == null &&
          "border-border bg-bg text-text-secondary hover:border-text-muted hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}

function KeywordChip({
  onRemove,
  label,
  excluded = false,
  children,
}: {
  onRemove: () => void;
  label: string;
  excluded?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={excluded ? `Remove NOT ${label}` : `Remove ${label}`}
      className={cn(
        "inline-flex items-center gap-1 pl-[0.55rem] pr-[0.45rem] py-[0.2rem] rounded-full border text-[0.8rem] leading-[1.2] cursor-pointer font-[inherit] transition-[background,border-color] duration-[120ms] hover:brightness-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2",
        excluded
          ? "border-red-200/90 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/45 dark:text-red-300 focus-visible:outline-red-400"
          : "border-accent bg-accent-light text-accent-text",
      )}
    >
      {excluded ? (
        <>
          <span className="font-semibold">NOT</span> {children}
        </>
      ) : (
        children
      )}
      <span className="text-[1rem] leading-none opacity-75" aria-hidden="true">×</span>
    </button>
  );
}

function cycleTermFilterMode(
  prev: Map<string, TermFilterMode>,
  term: string,
): Map<string, TermFilterMode> {
  const next = new Map(prev);
  const current = next.get(term);
  if (current === "include") {
    next.set(term, "exclude");
  } else if (current === "exclude") {
    next.delete(term);
  } else {
    next.set(term, "include");
  }
  return next;
}

function parseSemicolonTerms(rawTerms: string | undefined): string[] {
  if (!rawTerms) return [];
  return rawTerms
    .split(";")
    .map((term) => term.trim())
    .filter(Boolean);
}

function dedupeFiscalYears(
  years: ProjectFiscalYear[],
  currentProjectId: string,
): ProjectFiscalYear[] {
  const byKey = new Map<string, ProjectFiscalYear>();
  for (const year of years) {
    const key = year.fy != null ? `fy:${year.fy}` : `id:${year.project_id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, year);
      continue;
    }
    if (year.project_id === currentProjectId) {
      byKey.set(key, year);
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.fy == null && b.fy == null) return 0;
    if (a.fy == null) return 1;
    if (b.fy == null) return -1;
    return a.fy - b.fy;
  });
}

function dedupeYearVariants(variants: ProjectYearVariant[]): ProjectYearVariant[] {
  const byKey = new Map<string, ProjectYearVariant>();
  for (const variant of variants) {
    const key = variant.fy != null ? `fy:${variant.fy}` : `id:${variant.project_id}`;
    if (!byKey.has(key)) {
      byKey.set(key, variant);
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.fy == null && b.fy == null) return 0;
    if (a.fy == null) return 1;
    if (b.fy == null) return -1;
    return a.fy - b.fy;
  });
}

function dedupeTermsPreserveOrder(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const s = t.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function getProjectFamilyKey(item: SearchResultRecord): string | null {
  const title = item.PROJECT_TITLE?.trim();
  if (title) {
    return `title:${title.replace(/\s+/g, " ").toLowerCase()}`;
  }
  const core =
    typeof item.CORE_PROJECT_NUM === "string" ? item.CORE_PROJECT_NUM.trim() : "";
  if (core) {
    return `core:${core.toLowerCase()}`;
  }
  return null;
}

function markCurrentFiscalYear(
  years: ProjectFiscalYear[],
  projectId: string,
): ProjectFiscalYear[] {
  return years.map((year) => ({
    ...year,
    is_current: year.project_id === projectId,
  }));
}

function mergeFetchedIntoFamilyYears(
  familyYears: ProjectFiscalYear[],
  fetchedYears: ProjectFiscalYear[],
  projectId: string,
): ProjectFiscalYear[] {
  const fetchedByFy = new Map<number, ProjectFiscalYear>();
  for (const year of fetchedYears) {
    if (year.fy != null) {
      fetchedByFy.set(year.fy, year);
    }
  }

  const merged = familyYears.map((year) => {
    if (year.fy == null) return year;
    const fetched = fetchedByFy.get(year.fy);
    if (!fetched) return year;
    return {
      ...year,
      project_id: fetched.project_id,
      application_id: fetched.application_id,
    };
  });

  for (const fetched of fetchedYears) {
    if (fetched.fy == null) continue;
    if (!merged.some((year) => year.fy === fetched.fy)) {
      merged.push(fetched);
    }
  }

  return markCurrentFiscalYear(
    merged.sort((a, b) => {
      if (a.fy == null && b.fy == null) return 0;
      if (a.fy == null) return 1;
      if (b.fy == null) return -1;
      return a.fy - b.fy;
    }),
    projectId,
  );
}

function formatLocation(item: SearchResultRecord): string {
  const segments: string[] = [];
  if (item.ORG_CITY) segments.push(item.ORG_CITY);
  if (item.ORG_STATE) segments.push(item.ORG_STATE);
  if (item.ORG_ZIPCODE) segments.push(item.ORG_ZIPCODE);
  if (item.ORG_COUNTRY) segments.push(item.ORG_COUNTRY);
  return segments.join(", ") || "—";
}

function getProjectAbstract(item: SearchResultRecord): string | null {
  const abstractValue = item.ABSTRACT_TEXT ?? item.PROJECT_ABSTRACT ?? item.abstract;
  if (typeof abstractValue !== "string") return null;
  const normalized = abstractValue
    .replace(/^ABSTRACT\s*\n?/i, "")
    .replace(
      /^\s*project\s+summary(?:\s*\/\s*abstract)?\s*[:\-]?\s*(?:\r?\n)?/i,
      "",
    )
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([^\n])\n(?!\n)/g, "$1 ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function getYearVariants(record: SearchResultRecord): ProjectYearVariant[] {
  const raw = record.year_variants;
  if (Array.isArray(raw) && raw.length > 0) {
    const fromArray = raw.filter((item): item is ProjectYearVariant => item != null);
    if (fromArray.length > 0) return fromArray;
  }
  const recordId = record._id ?? record.id;
  const projectId =
    typeof recordId === "string" && recordId.trim()
      ? recordId
      : typeof recordId === "number"
        ? String(recordId)
        : null;
  if (!projectId) return [];
  const fy =
    typeof record.FY === "number" && Number.isFinite(record.FY) ? record.FY : undefined;
  return [
    {
      project_id: projectId,
      fy,
      application_id:
        typeof record.APPLICATION_ID === "number" ? record.APPLICATION_ID : undefined,
    },
  ];
}

function ProjectContentSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4 animate-pulse" aria-hidden="true">
      <div className="h-8 w-[85%] rounded-md bg-surface-hover" />
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-surface-hover" />
        <div className="h-3 w-full rounded bg-surface-hover" />
        <div className="h-3 w-[72%] rounded bg-surface-hover" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
        <div className="h-20 rounded-md bg-surface-hover" />
        <div className="h-20 rounded-md bg-surface-hover" />
      </div>
    </div>
  );
}

export default function ProjectDetailsPage({
  item,
  projectContentLoading = false,
  similarNeighbors,
  similarLoading,
  similarError,
  onBack,
  onOpenInvestigator,
  onOpenOrganization,
  onOpenInstitution,
  onOpenDetails,
  onSearchWithProjectTerms,
}: ProjectDetailsPageProps) {
  const navigate = useNavigate();
  const piNames = getOrderedPiNames(item.PI_NAMEs);
  const projectTerms = useMemo(() => parseSemicolonTerms(item.PROJECT_TERMS), [item.PROJECT_TERMS]);
  const dedupedProjectTerms = useMemo(
    () => dedupeTermsPreserveOrder(projectTerms),
    [projectTerms],
  );
  const [termFilters, setTermFilters] = useState<Map<string, TermFilterMode>>(() => new Map());
  const [keywordExtra, setKeywordExtra] = useState<string>("");
  const [termsExpanded, setTermsExpanded] = useState(false);
  const projectRecordId = typeof item._id === "string" ? item._id : typeof item.id === "string" ? item.id : "";
  const hasMoreTerms = dedupedProjectTerms.length > PROJECT_TERMS_INITIAL_VISIBLE;
  const visibleProjectTerms = useMemo(
    () =>
      termsExpanded || !hasMoreTerms
        ? dedupedProjectTerms
        : dedupedProjectTerms.slice(0, PROJECT_TERMS_INITIAL_VISIBLE),
    [dedupedProjectTerms, termsExpanded, hasMoreTerms],
  );
  const hiddenTermCount = Math.max(0, dedupedProjectTerms.length - PROJECT_TERMS_INITIAL_VISIBLE);

  useEffect(() => {
    setTermsExpanded(false);
  }, [projectRecordId, item.PROJECT_TERMS]);
  const includedTerms = useMemo(
    () => [...termFilters.entries()].filter(([, mode]) => mode === "include").map(([term]) => term),
    [termFilters],
  );
  const excludedTerms = useMemo(
    () => [...termFilters.entries()].filter(([, mode]) => mode === "exclude").map(([term]) => term),
    [termFilters],
  );
  const projectAbstract = getProjectAbstract(item);
  const [isAbstractExpanded, setIsAbstractExpanded] = useState<boolean>(false);
  const fiscalYears = item.FY != null ? String(item.FY) : "—";
  const projectDates = [item.PROJECT_START, item.PROJECT_END].filter(Boolean).join(" to ") || "—";
  const projectId = projectRecordId;
  const [projectYears, setProjectYears] = useState<ProjectFiscalYear[]>([]);
  const familyYearsCacheRef = useRef<ProjectFiscalYear[]>([]);
  const familyKeyCacheRef = useRef<string | null>(null);
  const displayProjectYears = useMemo(
    () => dedupeFiscalYears(projectYears, projectId),
    [projectYears, projectId],
  );
  const groupedSimilarNeighbors = useMemo(
    () => groupSimilarNeighbors(similarNeighbors),
    [similarNeighbors],
  );
  const isLongAbstract =
    projectAbstract != null && projectAbstract.length > ABSTRACT_PREVIEW_LENGTH;
  const abstractPreview =
    projectAbstract != null && isLongAbstract
      ? `${projectAbstract.slice(0, ABSTRACT_PREVIEW_LENGTH).trimEnd()}...`
      : projectAbstract;

  useEffect(() => {
    setIsAbstractExpanded(false);
  }, [item._id, item.APPLICATION_ID, item.PROJECT_TITLE]);

  useEffect(() => {
    setTermFilters(new Map());
    setKeywordExtra("");
  }, [item._id, item.APPLICATION_ID]);

  useEffect(() => {
    if (!projectId) {
      setProjectYears([]);
      familyYearsCacheRef.current = [];
      familyKeyCacheRef.current = null;
      return;
    }
    let cancelled = false;
    const familyKey = getProjectFamilyKey(item);
    void (async () => {
      try {
        const payload = await getProjectOtherYears(projectId);
        if (cancelled) return;
        const fetched = payload.years ?? payload.other_years ?? [];

        if (fetched.length > 1) {
          familyYearsCacheRef.current = fetched;
          familyKeyCacheRef.current = familyKey;
          setProjectYears(fetched);
          return;
        }

        if (
          familyKey &&
          familyKey === familyKeyCacheRef.current &&
          familyYearsCacheRef.current.length > 1
        ) {
          setProjectYears(
            mergeFetchedIntoFamilyYears(familyYearsCacheRef.current, fetched, projectId),
          );
          return;
        }

        familyYearsCacheRef.current = fetched;
        familyKeyCacheRef.current = fetched.length > 1 ? familyKey : null;
        setProjectYears(fetched);
      } catch {
        if (cancelled) return;
        if (
          familyKey &&
          familyKey === familyKeyCacheRef.current &&
          familyYearsCacheRef.current.length > 1
        ) {
          setProjectYears(markCurrentFiscalYear(familyYearsCacheRef.current, projectId));
          return;
        }
        setProjectYears([]);
        familyYearsCacheRef.current = [];
        familyKeyCacheRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, item.PROJECT_TITLE, item.CORE_PROJECT_NUM]);

  const handleOpenProjectYear = (year: ProjectFiscalYear): void => {
    if (!year.project_id || year.project_id === projectId) return;
    if (onOpenDetails) {
      onOpenDetails({ _id: year.project_id, FY: year.fy, APPLICATION_ID: year.application_id });
      return;
    }
    navigate(`/projects/${encodeURIComponent(year.project_id)}`);
  };

  const handleOpenYearVariant = (variant: ProjectYearVariant): void => {
    if (!variant.project_id) return;
    if (onOpenDetails) {
      onOpenDetails({
        _id: variant.project_id,
        FY: variant.fy,
        APPLICATION_ID: variant.application_id,
      });
      return;
    }
    navigate(`/projects/${encodeURIComponent(variant.project_id)}`);
  };

  const cycleTermSelection = (term: string): void => {
    setTermFilters((prev) => cycleTermFilterMode(prev, term));
  };

  const clearTermFilter = (term: string): void => {
    setTermFilters((prev) => {
      const next = new Map(prev);
      next.delete(term);
      return next;
    });
  };

  const clearKeywordPanel = (): void => {
    setTermFilters(new Map());
    setKeywordExtra("");
  };

  const handleProjectKeywordSearch = (): void => {
    if (!onSearchWithProjectTerms) return;
    const additionalQuery = keywordExtra.trim();
    if (includedTerms.length === 0 && excludedTerms.length === 0 && !additionalQuery) return;
    onSearchWithProjectTerms({
      terms: includedTerms,
      excludedTerms,
      additionalQuery,
    });
  };

  const handleOpenSimilarProjectsPage = (): void => {
    if (!projectId) return;
    const encodedProjectId = encodeURIComponent(projectId);
    navigate(`/semantic/similar/${encodedProjectId}`, {
      state: {
        returnTo: {
          pathname: `/projects/${encodedProjectId}`,
          search: "",
        },
      },
    });
  };

  return (
    <div className="grid grid-cols-[2fr_1fr] gap-[1.25rem] items-start w-full max-[960px]:grid-cols-1">
    <div className="flex flex-col gap-[1.25rem] min-w-0 w-full">
    <div className="bg-surface border border-border rounded-lg p-4 min-[901px]:p-6 w-full min-w-0">
      <div className="grid grid-cols-1 min-[901px]:grid-cols-[auto_1fr_auto] items-start min-[901px]:items-center gap-x-4 gap-y-3 mb-4">
        <BackToResultsButton onClick={onBack} />
        {displayProjectYears.length > 1 ? (
          <div className="flex flex-wrap justify-center items-center gap-[0.4rem] min-w-0" aria-label="Fiscal years for this project">
            {displayProjectYears.map((year) => {
              const isActive = year.project_id === projectId || year.is_current === true;
              const yearKey = `${year.fy ?? "na"}-${year.project_id}`;
              return (
                <FiscalYearTag
                  key={yearKey}
                  active={isActive}
                  onClick={() => handleOpenProjectYear(year)}
                >
                  {isActive
                    ? (year.fy != null ? `FY ${year.fy}` : "Current year")
                    : (year.fy != null ? `FY ${year.fy}` : "Other year")}
                </FiscalYearTag>
              );
            })}
          </div>
        ) : (
          <div aria-hidden="true" />
        )}
      </div>

      {projectContentLoading ? (
        <ProjectContentSkeleton />
      ) : (
        <>
      <h1 className="text-[1.55rem] leading-[1.35] mb-4">{item.PROJECT_TITLE ?? "Untitled Project"}</h1>

      <section className="mb-[1.25rem] w-full">
        <h2 className={CLS_SECTION_H2}>Project Abstract</h2>
        <p className={projectAbstract ? "text-text-primary whitespace-normal w-full max-w-none" : "text-text-secondary italic w-full max-w-none"}>
          {projectAbstract == null
            ? "No abstract available for this project."
            : isAbstractExpanded
            ? projectAbstract
            : abstractPreview}
        </p>
        {projectAbstract != null && isLongAbstract && (
          <button
            type="button"
            className="mt-[0.35rem] p-0 border-none bg-transparent text-accent font-sans text-[0.86rem] font-semibold cursor-pointer hover:underline"
            onClick={() => setIsAbstractExpanded((prev) => !prev)}
          >
            {isAbstractExpanded ? "Show less" : "Read more"}
          </button>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className={CLS_METADATA_ROW}>
          <div>
            <h2 className={CLS_SECTION_H2}>Principal Investigator Names</h2>
            {piNames.length > 0 ? (
              <ul className="list-disc pl-4">
                {piNames.map((name) => (
                  <li key={name}>
                    {onOpenInvestigator ? (
                      <button
                        type="button"
                        className={CLS_DETAIL_LINK_BTN}
                        onClick={() => onOpenInvestigator(name)}
                      >
                        {name}
                      </button>
                    ) : (
                      name
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-primary">—</p>
            )}
          </div>

          <div>
            <h2 className={CLS_SECTION_H2}>NIH Institute or Center</h2>
            <DetailLinkValue value={item.IC_NAME} onActivate={onOpenInstitution} />
          </div>

          <div>
            <h2 className={CLS_SECTION_H2}>Funded Organization</h2>
            <DetailLinkValue value={item.ORG_NAME} onActivate={onOpenOrganization} />
          </div>
        </div>

        <div className={CLS_METADATA_ROW}>
          <div>
            <h2 className={CLS_SECTION_H2}>Activity Code</h2>
            <p className="text-text-primary">{item.ACTIVITY ?? "—"}</p>
          </div>

          <div>
            <h2 className={CLS_SECTION_H2}>Fiscal Year(s)</h2>
            <p className="text-text-primary">{fiscalYears}</p>
          </div>

          <div>
            <h2 className={CLS_SECTION_H2}>Project Start/End</h2>
            <p className="text-text-primary">{projectDates}</p>
          </div>
        </div>

        <div className={CLS_METADATA_ROW_TWO}>
          <div>
            <h2 className={CLS_SECTION_H2}>Award Amount</h2>
            <p className="text-text-primary">{formatDollarsFull(item.TOTAL_COST)}</p>
          </div>

          <div>
            <h2 className={CLS_SECTION_H2}>Funded Location</h2>
            <p className="text-text-primary">{formatLocation(item)}</p>
          </div>
        </div>

        <div>
          <div className="mb-[0.35rem] flex items-center gap-2">
            <h2 className={cn(CLS_SECTION_H2, "mb-0")}>Keywords or Research Terms</h2>
            {onSearchWithProjectTerms ? (
              <HelpTooltip label={HELP_PROJECT_KEYWORDS.label}>{HELP_PROJECT_KEYWORDS.body}</HelpTooltip>
            ) : null}
          </div>
          {dedupedProjectTerms.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-[0.4rem] w-full items-center" role="group" aria-label="Project keyword tags">
                {visibleProjectTerms.map((term) => (
                  <KeywordTag
                    key={term}
                    mode={termFilters.get(term) ?? null}
                    onClick={() => cycleTermSelection(term)}
                  >
                    {term}
                  </KeywordTag>
                ))}
                {hasMoreTerms ? (
                  <button
                    type="button"
                    className="px-[0.55rem] py-[0.28rem] rounded-full border border-border bg-surface text-accent font-sans text-[0.78rem] font-medium cursor-pointer transition-[border-color,color,background] duration-150 hover:border-accent hover:bg-accent-light"
                    onClick={() => setTermsExpanded((prev) => !prev)}
                    aria-expanded={termsExpanded}
                  >
                    {termsExpanded ? "Show less" : `Show more (${hiddenTermCount} more)`}
                  </button>
                ) : null}
              </div>
              {onSearchWithProjectTerms ? (
                <div className="mt-[0.85rem] pt-[0.85rem] border-t border-border">
                  
                  <ul className="flex flex-wrap gap-[0.35rem] items-center list-none m-0 mb-[0.65rem] p-0 min-h-[1.6rem]" aria-label="Selected keywords for search">
                    {termFilters.size === 0 ? (
                      <li className="m-0 p-0 text-[0.82rem] text-text-muted italic">No tags selected yet</li>
                    ) : (
                      [...termFilters.entries()].map(([term, mode]) => (
                        <li key={`${mode}-${term}`}>
                          <KeywordChip
                            label={term}
                            excluded={mode === "exclude"}
                            onRemove={() => clearTermFilter(term)}
                          >
                            {term}
                          </KeywordChip>
                        </li>
                      ))
                    )}
                  </ul>
                  <div className="flex flex-col gap-[0.3rem] mb-[0.65rem]">
                    <label className="text-[0.78rem] text-text-muted" htmlFor="project-keyword-extra">
                      Also include in search
                    </label>
                    <input
                      id="project-keyword-extra"
                      type="text"
                      className="w-full max-w-[28rem] px-[0.6rem] py-[0.45rem] rounded-sm border border-border bg-surface text-text-primary font-[inherit] text-[0.88rem] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[1px]"
                      placeholder="Optional words (title, PI, keywords…)"
                      value={keywordExtra}
                      onChange={(e) => setKeywordExtra(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <button
                      type="button"
                      className="px-4 py-[0.45rem] rounded-sm border-none bg-accent text-white font-sans text-[0.88rem] font-medium cursor-pointer transition-[background] duration-150 disabled:opacity-45 disabled:cursor-not-allowed"
                      disabled={
                        termFilters.size === 0 && keywordExtra.trim() === ""
                      }
                      onClick={handleProjectKeywordSearch}
                    >
                      Search Projects
                    </button>
                    {(termFilters.size > 0 || keywordExtra.trim() !== "") ? (
                      <button
                        type="button"
                        className="px-[0.75rem] py-[0.45rem] rounded-sm border border-border bg-surface text-text-secondary font-sans text-[0.85rem] cursor-pointer hover:border-text-muted hover:text-text-primary"
                        onClick={clearKeywordPanel}
                      >
                        Clear selection
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-text-primary">—</p>
          )}
        </div>
      </section>
        </>
      )}
    </div>

    {projectId && !projectContentLoading ? (
      <div className="bg-surface border border-border rounded-[--radius-lg] p-5 w-full min-w-0 [&>section]:!mb-0" role="region" aria-label="Similar projects funding comparison">
        <ProjectSimilarProjectsChart
          currentProject={item}
          projectId={projectId}
          neighbors={groupedSimilarNeighbors}
          loading={similarLoading}
          error={similarError}
        />
      </div>
    ) : null}
    </div>

    <aside className="bg-surface border border-border rounded-lg p-[1.1rem_1.15rem] min-w-0" aria-labelledby="project-details-similar-heading">
      {projectId ? (
        <div className="flex justify-start mb-[0.5rem]">
          <button
            type="button"
            className={CLS_LINK_BTN}
            onClick={handleOpenSimilarProjectsPage}
          >
            See more similar projects
          </button>
        </div>
      ) : null}
      <div className="mb-[0.5rem] flex items-center gap-2">
        <h2 id="project-details-similar-heading" className="text-[0.98rem] font-semibold text-text-primary tracking-[-0.01em] m-0">
          Similar Projects
        </h2>
        {projectId ? (
          <HelpTooltip label={HELP_PROJECT_SIMILAR.label}>{HELP_PROJECT_SIMILAR.body}</HelpTooltip>
        ) : null}
      </div>
      <hr className="h-0 m-0 mb-[0.55rem] border-0 border-b border-text-secondary/60" role="presentation" aria-hidden="true" />
      {!projectId ? (
        <p className="text-[0.84rem] text-text-secondary leading-[1.45]">No document id on this record; vector similarity is unavailable.</p>
      ) : similarLoading ? (
        <p className="text-[0.84rem] text-text-secondary leading-[1.45]" role="status">
          Loading similar grants…
        </p>
      ) : similarError ? (
        <div className="text-[0.84rem] text-text-primary px-[0.75rem] py-[0.65rem] rounded-sm bg-accent-light border border-border-strong" role="alert">
          <p>{similarError}</p>
          {similarError.toLowerCase().includes("embedding") ? (
            <p className="text-[0.84rem] text-text-secondary leading-[1.45]">
              Reindex with embeddings enabled so k-NN can run for this document.
            </p>
          ) : null}
        </div>
      ) : groupedSimilarNeighbors.length === 0 ? (
        <p className="text-[0.84rem] text-text-secondary leading-[1.45]">No similar projects returned.</p>
      ) : (
        <ol className="list-none flex min-w-0 flex-col gap-[0.6rem]">
          {groupedSimilarNeighbors.map((neighbor, index) => {
            const yearVariants = dedupeYearVariants(getYearVariants(neighbor));
            const listKey = yearVariants.map((variant) => variant.project_id).join("-") || String(index);
            const primaryId = yearVariants[0]?.project_id ?? neighbor._id ?? neighbor.id ?? "";
            const canOpen = Boolean(onOpenDetails && primaryId);
            const title = neighbor.PROJECT_TITLE ?? "Untitled";
            const instituteLabel = neighbor.IC_NAME
              ? formatAllCapsLabel(formatDropdownLabel(neighbor.IC_NAME))
              : "";
            const handleOpenNeighbor = (): void => {
              onOpenDetails?.(neighbor);
            };
            return (
              <li
                key={listKey}
                className={cn(
                  "pb-[0.35rem] border-b border-text-secondary/60 last:pb-0 last:border-b-0",
                  canOpen &&
                    "group -mx-[0.55rem] rounded-md px-[0.55rem] cursor-pointer transition-[background] duration-100 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px]",
                )}
                role={canOpen ? "button" : undefined}
                tabIndex={canOpen ? 0 : undefined}
                onClick={canOpen ? handleOpenNeighbor : undefined}
                onKeyDown={
                  canOpen
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleOpenNeighbor();
                        }
                      }
                    : undefined
                }
                aria-label={canOpen ? `Project: ${title}` : undefined}
              >
                <div className="min-w-0 py-[0.3rem]">
                  <div className="flex items-start justify-between gap-2 mb-[0.45rem]">
                    <div
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <SimilarProjectYearTags
                        variants={yearVariants}
                        onSelect={handleOpenYearVariant}
                        matchRowHover={canOpen}
                      />
                    </div>
                    <div className="flex items-center justify-end gap-[0.4rem] flex-shrink-0 ml-auto">
                      {neighbor.ACTIVITY ? (
                        <span className="inline-block px-[0.42rem] py-[0.12rem] rounded-full border border-transparent text-[0.72rem] font-semibold leading-[1.3] bg-accent-light text-accent-text group-hover:bg-surface-hover group-hover:border-border-strong">
                          {neighbor.ACTIVITY}
                        </span>
                      ) : null}
                      <span className="font-mono text-[0.78rem] font-medium text-text-secondary whitespace-nowrap">
                        {formatDollarsFull(neighbor.TOTAL_COST)}
                      </span>
                    </div>
                  </div>
                  <p
                    className={cn(
                      "text-[0.9rem] font-semibold text-text-primary leading-[1.4] m-0",
                      canOpen && "group-hover:text-accent-hover",
                    )}
                  >
                    {title}
                  </p>
                  {instituteLabel ? (
                    <div className="mt-[0.3rem] min-w-0 w-full overflow-hidden">
                      <span
                        className={cn(
                          "block max-w-full truncate font-mono text-[0.78rem] font-medium",
                          canOpen
                            ? "text-accent-text group-hover:text-accent-hover"
                            : "text-text-secondary",
                        )}
                        title={instituteLabel}
                      >
                        {instituteLabel}
                      </span>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {projectId ? (
        <div className="flex justify-start mt-[0.85rem]">
          <button
            type="button"
            className={CLS_LINK_BTN}
            onClick={handleOpenSimilarProjectsPage}
          >
            Show more similar projects
          </button>
        </div>
      ) : null}
    </aside>
    </div>
  );
}
