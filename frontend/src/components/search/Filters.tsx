import { cloneElement, isValidElement, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeStateFacetKey,
  useCascadingFilterAvailability,
} from "../../hooks/useCascadingFilterAvailability";
import { useFilterDraft } from "../../hooks/useFilterDraft";
import type { FilterValues } from "../../types/filters";
import { hasActiveFilters, normalizeFiltersOnApply } from "../../types/filters";
import { CLS_FILTER_CONTROL_ACTIVE } from "../../utils/filterFieldStyles";
import { buildCascadingSelectOptions } from "../../utils/cascadingFilterOptions";
import {
  formatAllCapsLabel,
  formatDropdownLabel,
  resolveFiscalYearChoices,
} from "../../utils/filterLabels";
import type { FilterSelectOption } from "./FilterSelect";
import FilterField from "./FilterField";
import FilterSelect from "./FilterSelect";
import FiscalYearRangeSlider from "./FiscalYearRangeSlider";
import { cn } from "../../utils/cn";
import type { HelpTooltipContent } from "../../utils/helpContent";
import SearchBar from "./SearchBar";

export type FilterFieldHelpKey = "pi" | "ic" | "org" | "activity" | "state" | "fy";
export type FilterFieldHelp = Partial<Record<FilterFieldHelpKey, HelpTooltipContent>>;

const FILTER_FIELD_WIDTH = {
  pi: "w-[260px] max-[1100px]:flex-1 max-[1100px]:min-w-[140px]",
  ic: "w-[260px] max-[1100px]:flex-1 max-[1100px]:min-w-[130px]",
  org: "w-[260px] max-[1100px]:flex-1 max-[1100px]:min-w-[130px]",
  activity: "w-[145px] max-[1100px]:min-w-[110px]",
  state: "w-[145px] max-[1100px]:min-w-[100px]",
  fiscalYear: "w-[min(100%,220px)] shrink-0",
} as const;

const MOBILE_FILTER_FIELD_WIDTH = "box-border w-full min-w-0 p-0.50";
const MOBILE_FILTERS_GRID_CLASS =
  "grid w-full grid-cols-2 grid-rows-3 gap-2 [&>*]:min-w-0";

function duplicateHelpTooltip(node: ReactNode): ReactNode {
  return isValidElement(node) ? cloneElement(node) : node;
}

export type { FilterValues } from "../../types/filters";

export type FilterCatalog = {
  icNames: string[];
  orgNames: string[];
  activityCodes: string[];
  states: string[];
  fiscalYearOptions?: number[];
};

type SelectFieldKey = "ic" | "org" | "activity" | "state";

type SelectFieldConfig = {
  key: SelectFieldKey;
  label: string;
  width: string;
  placeholder: string;
  ariaLabel?: string;
  menuMinWidthPx?: number;
  listColumns?: number;
  truncateSelectedLabel?: boolean;
};

const SELECT_FIELDS: readonly SelectFieldConfig[] = [
  {
    key: "ic",
    label: "NIH Institute / Center",
    width: FILTER_FIELD_WIDTH.ic,
    placeholder: "All",
    menuMinWidthPx: 300,
    truncateSelectedLabel: true,
  },
  {
    key: "org",
    label: "Organization",
    width: FILTER_FIELD_WIDTH.org,
    placeholder: "All",
    menuMinWidthPx: 300,
    truncateSelectedLabel: true,
  },
  {
    key: "activity",
    label: "Activity Code",
    width: FILTER_FIELD_WIDTH.activity,
    placeholder: "All",
    listColumns: 3,
    menuMinWidthPx: 260,
  },
  {
    key: "state",
    label: "State",
    width: FILTER_FIELD_WIDTH.state,
    placeholder: "All",
    ariaLabel: "State",
    listColumns: 3,
    menuMinWidthPx: 260,
  },
];

type FiltersProps = {
  applied: FilterValues;
  catalog: FilterCatalog;
  onApply: (filters: FilterValues) => void;
  onClear: () => void;
  searchQuery?: string;
  onSearch?: (query: string, filters?: FilterValues) => void;
  showAdvancedToggle?: boolean;
  semanticMode?: boolean;
  onSemanticModeChange?: (enabled: boolean) => void;
  showSemanticToggle?: boolean;
  onUpdateDashboard?: (query: string) => void;
  searchSubmitOnClear?: boolean;
  fieldHelp?: FilterFieldHelp;
  searchSlot?: ReactNode;
  /** Optional help control shown at the top-right of the filter panel. */
  helpTooltip?: ReactNode;
  /** Dashboard: drives activity-code preview in the funding pie chart area. */
  onActivityCodeHover?: (code: string | null) => void;
  /** Dashboard: highlight applied facet filters with pulsing border. */
  highlightActiveFilters?: boolean;
};

function FiltersIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M2 4h12" strokeLinecap="round" />
      <path d="M4 8h8" strokeLinecap="round" />
      <path d="M6 12h4" strokeLinecap="round" />
    </svg>
  );
}

function Filters({
  applied,
  catalog,
  onApply,
  onClear,
  searchQuery,
  onSearch,
  showAdvancedToggle = true,
  semanticMode = false,
  onSemanticModeChange,
  showSemanticToggle = false,
  onUpdateDashboard,
  searchSubmitOnClear = true,
  fieldHelp,
  searchSlot,
  helpTooltip,
  onActivityCodeHover,
  highlightActiveFilters = false,
}: FiltersProps) {
  const { draft, patch, resetDraft } = useFilterDraft(applied);

  const isAppliedFilterActive = useCallback(
    (key: SelectFieldKey | "pi"): boolean => {
      if (!highlightActiveFilters) return false;
      return Boolean(applied[key].trim());
    },
    [applied, highlightActiveFilters],
  );
  const cascadingAvailability = useCascadingFilterAvailability(draft);
  const [filtersMenuOpen, setFiltersMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const fyChoices = useMemo(
    () => resolveFiscalYearChoices(catalog.fiscalYearOptions),
    [catalog.fiscalYearOptions],
  );

  const selectOptionsByKey = useMemo((): Record<SelectFieldKey, FilterSelectOption[]> => ({
    ic: buildCascadingSelectOptions(
      catalog.icNames,
      cascadingAvailability?.ic ?? null,
      draft.ic,
      formatDropdownLabel,
      false,
    ),
    org: buildCascadingSelectOptions(
      catalog.orgNames,
      cascadingAvailability?.org ?? null,
      draft.org,
      formatDropdownLabel,
    ),
    activity: buildCascadingSelectOptions(
      catalog.activityCodes,
      cascadingAvailability?.activity ?? null,
      draft.activity,
      formatAllCapsLabel,
    ),
    state: buildCascadingSelectOptions(
      catalog.states,
      cascadingAvailability?.state ?? null,
      draft.state,
      formatAllCapsLabel,
      true,
      normalizeStateFacetKey,
    ),
  }), [
    catalog.icNames,
    catalog.orgNames,
    catalog.activityCodes,
    catalog.states,
    cascadingAvailability,
    draft.ic,
    draft.org,
    draft.activity,
    draft.state,
  ]);

  const handleApply = useCallback(() => {
    onApply(normalizeFiltersOnApply(draft, fyChoices));
  }, [draft, fyChoices, onApply]);

  const handleClear = useCallback(() => {
    resetDraft();
    onClear();
    setFiltersMenuOpen(false);
  }, [onClear, resetDraft]);

  const handleSearchNavigate = useCallback(
    (q: string) => {
      const filters = normalizeFiltersOnApply(draft, fyChoices);
      onApply(filters);
      onSearch?.(q, filters);
    },
    [draft, fyChoices, onApply, onSearch],
  );

  const filtersActive = hasActiveFilters(applied);

  useEffect(() => {
    if (!filtersMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (mobileMenuRef.current?.contains(target)) return;
      if (
        target instanceof Element
        && target.closest("[data-mobile-filters-trigger]")
      ) {
        return;
      }
      setFiltersMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersMenuOpen]);

  const renderFilterFields = (layout: "desktop" | "mobile") => {
    const piWidth = layout === "mobile" ? MOBILE_FILTER_FIELD_WIDTH : FILTER_FIELD_WIDTH.pi;
    const fyWidth = layout === "mobile" ? MOBILE_FILTER_FIELD_WIDTH : FILTER_FIELD_WIDTH.fiscalYear;

    return (
      <>
        <FilterField
          label="Principal Investigator"
          help={fieldHelp?.pi}
          className={piWidth}
        >
          <input
            className={cn(
              "box-border w-full min-h-[2.5rem] rounded-sm border-2 border-border-input bg-bg px-[0.7rem] py-[0.48rem] font-sans text-[14px] leading-[1.35] text-text-primary outline-none transition-[border-color] duration-150 hover:border-border-strong focus:border-accent placeholder:text-text-muted",
              isAppliedFilterActive("pi") && CLS_FILTER_CONTROL_ACTIVE,
            )}
            type="text"
            placeholder="Type PI name"
            value={draft.pi}
            onChange={(e) => patch({ pi: e.target.value })}
            onBlur={handleApply}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleApply();
              }
            }}
          />
        </FilterField>

        {SELECT_FIELDS.map((field) => (
          <FilterField
            key={field.key}
            label={field.label}
            help={
              field.key === "ic"
                ? fieldHelp?.ic
                : field.key === "org"
                  ? fieldHelp?.org
                  : field.key === "activity"
                    ? fieldHelp?.activity
                    : field.key === "state"
                      ? fieldHelp?.state
                      : undefined
            }
            className={layout === "mobile" ? MOBILE_FILTER_FIELD_WIDTH : field.width}
          >
            <FilterSelect
              value={draft[field.key]}
              active={isAppliedFilterActive(field.key)}
              onChange={(value) => {
                const next = { ...draft, [field.key]: value };
                patch({ [field.key]: value });
                onApply(normalizeFiltersOnApply(next, fyChoices));
              }}
              options={selectOptionsByKey[field.key]}
              placeholder={field.placeholder}
              ariaLabel={field.ariaLabel}
              menuMinWidthPx={field.menuMinWidthPx}
              listColumns={field.listColumns}
              truncateSelectedLabel={field.truncateSelectedLabel}
              onOptionPointerEnter={
                field.key === "activity" && onActivityCodeHover
                  ? (opt) => onActivityCodeHover(opt.value)
                  : undefined
              }
              onOptionPointerLeave={
                field.key === "activity" && onActivityCodeHover
                  ? () => onActivityCodeHover(null)
                  : undefined
              }
            />
          </FilterField>
        ))}

        <FilterField
          label="Fiscal Year"
          help={fieldHelp?.fy}
          className={fyWidth}
        >
          <FiscalYearRangeSlider
            choices={fyChoices}
            fyMin={draft.fyMin}
            fyMax={draft.fyMax}
            onChange={(fyMin, fyMax) => patch({ fyMin, fyMax })}
            onCommit={(fyMin, fyMax) => {
              onApply(
                normalizeFiltersOnApply({ ...draft, fyMin, fyMax }, fyChoices),
              );
            }}
          />
        </FilterField>
      </>
    );
  };

  const mobileFiltersButton = (
    <button
      type="button"
      data-mobile-filters-trigger
      className={cn(
        "inline-flex min-[901px]:hidden shrink-0 cursor-pointer select-none items-center gap-[0.35rem] rounded-sm border px-[0.55rem] py-[0.48rem] font-sans text-[14px] font-medium transition-colors duration-150",
        filtersMenuOpen || filtersActive
          ? "border-accent-hover bg-accent-hover text-white hover:bg-accent"
          : "border-accent bg-accent/30 text-black hover:border-accent-hover hover:bg-accent/40",
      )}
      onClick={() => setFiltersMenuOpen((open) => !open)}
      aria-expanded={filtersMenuOpen}
      aria-haspopup="dialog"
      aria-label="Search filters"
    >
      <FiltersIcon />
      Filters
    </button>
  );

  const searchContent =
    searchSlot != null ? (
      <div className="flex min-w-0 w-full items-start gap-2">
        <div className="min-w-0 flex-1">{searchSlot}</div>
        {mobileFiltersButton}
      </div>
    ) : onSearch != null ? (
      <SearchBar
        onSearch={handleSearchNavigate}
        showAdvancedToggle={showAdvancedToggle}
        semanticMode={semanticMode}
        onSemanticModeChange={onSemanticModeChange}
        showSemanticToggle={showSemanticToggle}
        onUpdateDashboard={onUpdateDashboard}
        initialQuery={searchQuery ?? ""}
        submitOnClear={searchSubmitOnClear}
        toolbarEnd={mobileFiltersButton}
        toolbarTrailing={
          helpTooltip ? (
            <span className="min-[901px]:hidden shrink-0">{duplicateHelpTooltip(helpTooltip)}</span>
          ) : null
        }
      />
    ) : null;

  return (
    <section className="relative -mt-1 flex flex-col items-stretch gap-[0.4rem] overflow-x-auto rounded-lg border border-border bg-surface px-3 pt-2.5 pb-3 max-[900px]:overflow-visible min-[1101px]:overflow-x-visible">
      {helpTooltip ? (
        <div className="absolute top-2.5 right-3 z-10 max-[900px]:hidden">
          {duplicateHelpTooltip(helpTooltip)}
        </div>
      ) : null}
      {searchContent ? (
        <div className="relative min-w-0 w-full pt-0.5 pb-1">
          {searchContent}
          {filtersMenuOpen ? (
            <div
              ref={mobileMenuRef}
              className="absolute inset-x-0 top-full z-20 mt-2 hidden max-[900px]:block rounded-lg border border-border bg-surface p-3 shadow-md"
              role="dialog"
              aria-label="Search filters"
            >
              <div className={MOBILE_FILTERS_GRID_CLASS}>
                {renderFilterFields("mobile")}
              </div>
              <div className="mt-3 flex justify-end border-t border-border pt-3">
                <button
                  type="button"
                  className="box-border min-h-[2rem] min-w-[4rem] cursor-pointer whitespace-nowrap rounded-sm border border-red-200/90 bg-red-50 px-4 font-sans text-[13px] font-medium text-red-700 transition-all duration-150 hover:border-red-300 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/45 dark:text-red-300 dark:hover:border-red-800/70 dark:hover:bg-red-950/70"
                  onClick={handleClear}
                >
                  Clear All
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-w-0 w-full flex-wrap items-end justify-start gap-5 max-[900px]:hidden">
        {renderFilterFields("desktop")}

        <div className="shrink-0">
          <button
            type="button"
            className="box-border min-h-[2rem] min-w-[4rem] cursor-pointer whitespace-nowrap rounded-sm border border-red-200/90 bg-red-50 px-4 font-sans text-[13px] font-medium text-red-700 transition-all duration-150 hover:border-red-300 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/45 dark:text-red-300 dark:hover:border-red-800/70 dark:hover:bg-red-950/70"
            onClick={handleClear}
          >
            Clear All
          </button>
        </div>
      </div>
    </section>
  );
}

export default Filters;
