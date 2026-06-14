import { type FC, type ReactNode, useEffect, useState } from "react";
import type { AdvancedSearchQuery } from "../../types/advancedSearch";
import {
  composeUnifiedSearch,
  createDefaultAdvancedSearchQuery,
  hasUnifiedAdvancedContent,
  normalizeUnifiedSearch,
  parseUnifiedSearch,
} from "../../utils/advancedSearch";
import HelpTooltip, { CLS_HELP_TRIGGER_ON_ACCENT } from "../shared/HelpTooltip";
import { cn } from "../../utils/cn";
import { HELP_SEARCH_ADVANCED, HELP_SEARCH_SEMANTIC } from "../../utils/helpContent";
import AdvancedSearchModal from "./AdvancedSearchModal";

type SearchBarProps = {
  onSearch: (query: string) => void;
  /** When set, shows a green "Update Dashboard" submit button; Search becomes a navigate action. */
  onUpdateDashboard?: (query: string) => void;
  initialQuery?: string;
  /** When false, × only clears the input (no callback). Default true. */
  submitOnClear?: boolean;
  /** When false, hides the advanced-search toggle (e.g. dashboard keyword bar). */
  showAdvancedToggle?: boolean;
  semanticMode?: boolean;
  onSemanticModeChange?: (enabled: boolean) => void;
  /** When false, hides the semantic-search checkbox (e.g. dashboard). */
  showSemanticToggle?: boolean;
  /** Extra controls on the toolbar row (e.g. mobile Filters button). */
  toolbarEnd?: ReactNode;
  /** Trailing control aligned to the end of the toolbar row (e.g. mobile help ?). */
  toolbarTrailing?: ReactNode;
};

const SEARCH_MODE_TOGGLE_BTN_BASE =
  "shrink-0 select-none rounded-sm border px-[0.55rem] py-[0.48rem] font-sans text-[14px] font-medium transition-colors duration-150";

function searchModeToggleShellClass(active: boolean, disabled: boolean): string {
  return cn(
    SEARCH_MODE_TOGGLE_BTN_BASE,
    "inline-flex items-center gap-1.5 py-[0.38rem] pl-[0.55rem] pr-[0.4rem]",
    disabled && "opacity-50",
    active
      ? "border-accent bg-accent text-white hover:bg-accent-hover"
      : "border-accent-hover bg-accent/40 text-text-primary hover:border-accent-hover hover:bg-accent/60",
  );
}

type SearchModeToggleProps = {
  label: string;
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
  helpLabel: string;
  helpBody: ReactNode;
};

function SearchModeToggle({
  label,
  active,
  disabled,
  onToggle,
  helpLabel,
  helpBody,
}: SearchModeToggleProps): JSX.Element {
  return (
    <div className={searchModeToggleShellClass(active, disabled)}>
      <button
        type="button"
        className={cn(
          "cursor-pointer border-none bg-transparent p-0 font-sans text-[14px] font-medium leading-none outline-none",
          active ? "text-white" : "text-inherit",
          disabled ? "cursor-not-allowed" : undefined,
        )}
        disabled={disabled}
        aria-pressed={active}
        onClick={onToggle}
      >
        {label}
      </button>
      <HelpTooltip
        label={helpLabel}
        variant="icon"
        triggerClassName={active ? CLS_HELP_TRIGGER_ON_ACCENT : undefined}
      >
        {helpBody}
      </HelpTooltip>
    </div>
  );
}

const SearchBar: FC<SearchBarProps> = ({
  onSearch,
  onUpdateDashboard,
  initialQuery = "",
  submitOnClear = true,
  showAdvancedToggle = true,
  semanticMode = false,
  onSemanticModeChange,
  showSemanticToggle = false,
  toolbarEnd,
  toolbarTrailing,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isDashboardMode = onUpdateDashboard != null;
  const hasAdvancedInBar = hasUnifiedAdvancedContent(query);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const commitQuery = (raw: string) => {
    const unified = normalizeUnifiedSearch(raw);
    if (isDashboardMode) {
      onUpdateDashboard(unified);
    } else {
      onSearch(unified);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    commitQuery(query);
  };

  const handleSearchClick = () => {
    onSearch(normalizeUnifiedSearch(query));
  };

  const handleClear = () => {
    setAdvancedOpen(false);
    setQuery("");
    if (!submitOnClear) return;
    if (isDashboardMode) {
      onUpdateDashboard("");
    } else {
      onSearch("");
    }
  };

  const handleAdvancedSubmit = (nextAdvanced: AdvancedSearchQuery) => {
    const { plainQ } = parseUnifiedSearch(query);
    const unified = composeUnifiedSearch(nextAdvanced, plainQ);
    setQuery(unified);
    setAdvancedOpen(false);
    commitQuery(unified);
  };

  const setAdvancedEnabled = (enabled: boolean) => {
    if (enabled) {
      setAdvancedOpen(true);
      return;
    }
    setAdvancedOpen(false);
    const { plainQ } = parseUnifiedSearch(query);
    setQuery(plainQ);
  };

  const handleAdvancedClick = () => {
    if (advancedToggleDisabled) return;
    if (semanticMode && onSemanticModeChange != null) {
      onSemanticModeChange(false);
    }
    if (advancedActive) {
      setAdvancedEnabled(false);
      return;
    }
    setAdvancedEnabled(true);
  };

  const handleSemanticClick = () => {
    if (semanticToggleDisabled || onSemanticModeChange == null) return;
    if (!semanticMode && hasAdvancedInBar) {
      setAdvancedEnabled(false);
    }
    onSemanticModeChange(!semanticMode);
  };

  const modalInitialQuery = (() => {
    const parsed = parseUnifiedSearch(query);
    return parsed.advanced ?? createDefaultAdvancedSearchQuery();
  })();

  const useExpandedLayout = showAdvancedToggle || showSemanticToggle;
  const advancedToggleDisabled = semanticMode && onSemanticModeChange == null;
  const semanticToggleDisabled = hasAdvancedInBar && !showAdvancedToggle;
  const advancedActive = hasAdvancedInBar || advancedOpen;

  const advancedControl = showAdvancedToggle ? (
    <SearchModeToggle
      label="Advanced"
      active={advancedActive}
      disabled={advancedToggleDisabled}
      onToggle={handleAdvancedClick}
      helpLabel={HELP_SEARCH_ADVANCED.label}
      helpBody={HELP_SEARCH_ADVANCED.body}
    />
  ) : null;

  const semanticControl =
    showSemanticToggle && onSemanticModeChange != null ? (
      <SearchModeToggle
        label="Semantic"
        active={semanticMode}
        disabled={semanticToggleDisabled}
        onToggle={handleSemanticClick}
        helpLabel={HELP_SEARCH_SEMANTIC.label}
        helpBody={HELP_SEARCH_SEMANTIC.body}
      />
    ) : null;

  const searchForm = (
    <form
        onSubmit={handleSubmit}
        className="flex w-full min-w-0 items-center gap-2 rounded-md border-2 border-border-input bg-bg px-2 py-[0.3rem] transition-[border-color,box-shadow] duration-150 hover:border-border-strong focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(26,86,219,0.1)]"
      >
        <svg
          className="h-4 w-4 shrink-0 text-text-muted"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L13.5 13.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          className="min-w-0 flex-1 border-none bg-transparent py-[0.52rem] font-sans text-[14px] text-text-primary outline-none placeholder:text-text-muted"
          placeholder={
            semanticMode
              ? "Describe the research you are looking for…"
              : "Search NIH projects by title, PI, keywords…"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {hasAdvancedInBar ? (
          <button
            type="button"
            onClick={() => setAdvancedOpen(true)}
            className="shrink-0 cursor-pointer border-none bg-transparent px-0.5 font-sans text-[13px] font-medium text-accent-text underline-offset-2 hover:underline"
          >
            Edit
          </button>
        ) : null}
        {query ? (
          <button
            type="button"
            onClick={handleClear}
            className="cursor-pointer border-none bg-transparent px-0.5 text-[19px] leading-none text-text-muted"
            aria-label="Clear search"
          >
            ×
          </button>
        ) : null}
        {isDashboardMode ? (
          <>
            <button
              type="submit"
              className="cursor-pointer whitespace-nowrap rounded-sm border-none bg-green px-[0.75rem] py-[0.38rem] font-sans text-sm font-medium text-white transition-colors duration-150 hover:brightness-110"
            >
              Update
            </button>
            <button
              type="button"
              onClick={handleSearchClick}
              className="cursor-pointer whitespace-nowrap rounded-sm border-none bg-accent px-[0.9rem] py-[0.38rem] font-sans text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-hover"
            >
              Search
            </button>
          </>
        ) : (
          <button
            type="submit"
            className="cursor-pointer whitespace-nowrap rounded-sm border-none bg-accent px-[0.9rem] py-[0.38rem] font-sans text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-hover"
          >
            Search
          </button>
        )}
      </form>
  );

  const modeToggleControls =
    semanticControl != null || advancedControl != null || toolbarEnd != null || toolbarTrailing != null ? (
      <div className="flex w-full min-[901px]:w-auto shrink-0 items-center gap-2 max-[900px]:justify-between">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {semanticControl}
          {advancedControl}
          {toolbarEnd}
        </div>
        {toolbarTrailing}
      </div>
    ) : null;

  return (
    <>
      {useExpandedLayout ? (
        <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-2 max-[900px]:flex-col max-[900px]:items-stretch">
          <div className="min-w-0 w-full max-w-[32rem] flex-1 min-[901px]:flex-none">
            {searchForm}
          </div>
          {modeToggleControls}
        </div>
      ) : (
        searchForm
      )}
      {showAdvancedToggle ? (
        <AdvancedSearchModal
          open={advancedOpen}
          initialQuery={modalInitialQuery}
          onClose={() => setAdvancedOpen(false)}
          onSubmit={handleAdvancedSubmit}
        />
      ) : null}
    </>
  );
};

export default SearchBar;
