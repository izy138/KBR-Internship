import {
  type FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTheme } from "./hooks/useTheme";
import { useProjectDetails } from "./hooks/useProjectDetails";
import { useSimilarProjects } from "./hooks/useSimilarProjects";
import { stubProjectFromId } from "./utils/stubProject";
import { useInvestigatorProjects, ENTITY_LIST_PER_PAGE } from "./hooks/useInvestigatorProjects";
import { useOrganizationProjects } from "./hooks/useOrganizationProjects";
import { useInstitutionProjects } from "./hooks/useInstitutionProjects";
import { useSearch } from "./hooks/useSearch";
import { readInitialDashboardFromWindow, useDashboardUrlSync } from "./hooks/useDashboardUrlSync";
import { readInitialSearchFromWindow, useSearchUrlSync } from "./hooks/useSearchUrlSync";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import type { SortOption } from "./utils/searchUrlParams";
import Filters from "./components/search/Filters";
import FilterSelect from "./components/search/FilterSelect";
import InvestigatorPage from "./components/investigator/InvestigatorPage";
import ResultsList, { type SortState as ResultsSortState } from "./components/search/ResultsList";
import BackToResultsButton from "./components/shared/BackToResultsButton";
import Pagination, { getPageNumbers } from "./components/shared/Pagination";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import {
  downloadSearchResultsCsv,
  type SearchResultRecord,
  type SearchSortDirection,
  type SearchSortField,
} from "./api";
import HelpTooltip from "./components/shared/HelpTooltip";
import {
  HELP_SEARCH,
  HELP_SEARCH_FILTER_ACTIVITY,
  HELP_SEARCH_FILTER_FY,
  HELP_SEARCH_FILTER_IC,
  HELP_SEARCH_FILTER_ORG,
  HELP_SEARCH_FILTER_PI,
  HELP_SEARCH_FILTER_STATE,
} from "./utils/helpContent";
import {
  hasAdvancedSearchContent,
  normalizeUnifiedSearch,
  parseUnifiedSearch,
} from "./utils/advancedSearch";
import { unifiedSearchFromParsed } from "./utils/searchUrlParams";
import { useFilterCatalog } from "./hooks/useFilterCatalog";
import type { FilterValues } from "./types/filters";
import {
  type FilterBreadcrumbKey,
  filterBreadcrumbOrderFromSearchParams,
  updateFilterBreadcrumbOrder,
} from "./utils/filterBreadcrumbOrder";
import { cn } from "./utils/cn";
import {
  getListReturnForProjectNavigation,
  navigateBackToList,
  navigateToProject,
  readReturnTo,
} from "./utils/navigationState";
import { buildDashboardUrlParams, buildSearchUrlParams, searchParamsToString } from "./utils/searchUrlParams";

const Dashboard = lazy(() => import("./components/dashboard/Dashboard"));
const ProjectDetailsPage = lazy(() => import("./components/project/ProjectDetailsPage"));
const SemanticVectorLabPage = lazy(() => import("./components/semantic/SemanticVectorLabPage"));
const SemanticSimilarProjectPage = lazy(() => import("./components/semantic/SemanticSimilarProjectPage"));

const SORT_SELECT_OPTIONS = [
  { value: "relevant", label: "Most Relevant" },
  { value: "alphaAsc", label: "Title: A to Z" },
  { value: "alphaDesc", label: "Title: Z to A" },
] as const;

const PER_PAGE_SELECT_OPTIONS = [10, 25, 50, 100].map((n) => ({
  value: String(n),
  label: `${n} per page`,
}));

export default function App() {
  const initialSearchUrl =
    readInitialSearchFromWindow() ?? readInitialDashboardFromWindow();

  const [searchQuery, setSearchQuery] = useState(() =>
    initialSearchUrl ? unifiedSearchFromParsed(initialSearchUrl) : "",
  );
  const [semanticSearchMode, setSemanticSearchMode] = useState(
    () => initialSearchUrl?.semantic ?? false,
  );
  const [semanticSearchCommitted, setSemanticSearchCommitted] = useState(
    () => initialSearchUrl?.semantic ?? false,
  );
  const [selectedPI, setSelectedPI] = useState(() => initialSearchUrl?.pi ?? "");
  const [selectedIC, setSelectedIC] = useState(() => initialSearchUrl?.ic ?? "");
  const [selectedOrg, setSelectedOrg] = useState(() => initialSearchUrl?.org ?? "");
  const [selectedActivity, setSelectedActivity] = useState(
    () => initialSearchUrl?.activity ?? "",
  );
  const [selectedState, setSelectedState] = useState(() => initialSearchUrl?.state ?? "");
  const [filterBreadcrumbOrder, setFilterBreadcrumbOrder] = useState<FilterBreadcrumbKey[]>(
    () =>
      typeof window !== "undefined"
        ? filterBreadcrumbOrderFromSearchParams(new URLSearchParams(window.location.search))
        : [],
  );
  const [fyMin, setFyMin] = useState(() => initialSearchUrl?.fyMin ?? "");
  const [fyMax, setFyMax] = useState(() => initialSearchUrl?.fyMax ?? "");

  const [resultsPerPage, setResultsPerPage] = useState(() => initialSearchUrl?.limit ?? 25);
  const [currentPage, setCurrentPage] = useState(() => initialSearchUrl?.page ?? 1);
  const [jumpToPageInput, setJumpToPageInput] = useState(() =>
    String(initialSearchUrl?.page ?? 1),
  );
  const [sortOption, setSortOption] = useState<SortOption>(
    () => initialSearchUrl?.sortOption ?? "relevant",
  );
  /**
   * Tracks the active column-header sort. When set, it takes precedence over
   * `sortOption` so the column the user clicked is what gets pushed to the
   * backend (which sorts the full result set, not just the current page).
   */
  const [columnSort, setColumnSort] = useState<ResultsSortState>(
    () => initialSearchUrl?.columnSort ?? { column: null, direction: "none" },
  );
  const [investigatorPage, setInvestigatorPage] = useState(1);
  const [organizationPage, setOrganizationPage] = useState(1);
  const [institutionPage, setInstitutionPage] = useState(1);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportCsvError, setExportCsvError] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, handleThemeToggle } = useTheme();

  const isDashboardRoute =
    location.pathname === "/"
    || location.pathname === "/dashboard"
    || location.pathname === "/dashboard/";
  const isSearchRoute =
    location.pathname === "/search" || location.pathname === "/search/";
  const view = isDashboardRoute ? "dashboard" : "search";

  const mainRef = useRef<HTMLElement | null>(null);
  const projectRouteMatch = matchPath("/projects/:projectId", location.pathname);
  const selectedProjectId = projectRouteMatch?.params.projectId ?? null;
  const semanticSimilarMatch = matchPath("/semantic/similar/:projectId", location.pathname);
  const semanticSimilarProjectId = semanticSimilarMatch?.params.projectId ?? null;
  const isSemanticHub =
    location.pathname === "/semantic" || location.pathname === "/semantic/";
  const isSemanticRoute = isSemanticHub || Boolean(semanticSimilarProjectId);
  const investigatorRouteMatch = matchPath("/investigators/:investigatorName", location.pathname);
  const selectedInvestigatorName = investigatorRouteMatch?.params.investigatorName
    ? decodeURIComponent(investigatorRouteMatch.params.investigatorName)
    : null;
  const organizationRouteMatch = matchPath("/organizations/:organizationName", location.pathname);
  const selectedOrganizationName = organizationRouteMatch?.params.organizationName
    ? decodeURIComponent(organizationRouteMatch.params.organizationName)
    : null;
  const institutionRouteMatch = matchPath("/institutions/:institutionName", location.pathname);
  const selectedInstitutionName = institutionRouteMatch?.params.institutionName
    ? decodeURIComponent(institutionRouteMatch.params.institutionName)
    : null;
  const searchEnabled =
    isSearchRoute
    && !selectedProjectId
    && !selectedInvestigatorName
    && !selectedOrganizationName
    && !selectedInstitutionName
    && !semanticSimilarProjectId
    && !isSemanticHub;

  const dashboardUrlSyncEnabled = isDashboardRoute && !isSemanticRoute;

  const { sortBy, sortOrder } = useMemo<{
    sortBy: SearchSortField | "";
    sortOrder: SearchSortDirection;
  }>(() => {
    // Column-header sort wins over the primary dropdown so the chevron the
    // user is actively pointing at always matches what the API returned.
    if (columnSort.column && columnSort.direction !== "none") {
      return { sortBy: columnSort.column, sortOrder: columnSort.direction };
    }
    if (sortOption === "alphaAsc") return { sortBy: "PROJECT_TITLE", sortOrder: "asc" };
    if (sortOption === "alphaDesc") return { sortBy: "PROJECT_TITLE", sortOrder: "desc" };
    return { sortBy: "", sortOrder: "asc" };
  }, [columnSort, sortOption]);

  const [projectTermFilters, setProjectTermFilters] = useState<string[]>(
    () => initialSearchUrl?.projectTerms ?? [],
  );
  const [excludeProjectTermFilters, setExcludeProjectTermFilters] = useState<string[]>([]);

  useDashboardUrlSync({
    enabled: dashboardUrlSyncEnabled,
    state: {
      q: searchQuery,
      pi: selectedPI,
      ic: selectedIC,
      org: selectedOrg,
      activity: selectedActivity,
      state: selectedState,
      fyMin,
      fyMax,
      semanticMode: semanticSearchMode,
      semanticCommitted: semanticSearchCommitted,
    },
    setters: {
      setQ: setSearchQuery,
      setPi: setSelectedPI,
      setIc: setSelectedIC,
      setOrg: setSelectedOrg,
      setActivity: setSelectedActivity,
      setState: setSelectedState,
      setFyMin,
      setFyMax,
      setSemanticMode: setSemanticSearchMode,
      setSemanticCommitted: setSemanticSearchCommitted,
      setFilterBreadcrumbOrder,
    },
  });

  const { navigateToSearch } = useSearchUrlSync({
    enabled: searchEnabled,
    state: {
      q: searchQuery,
      page: currentPage,
      limit: resultsPerPage,
      pi: selectedPI,
      ic: selectedIC,
      org: selectedOrg,
      activity: selectedActivity,
      state: selectedState,
      fyMin,
      fyMax,
      projectTerms: projectTermFilters,
      sortBy,
      sortOrder,
      sortOption,
      columnSort,
      semanticMode: semanticSearchMode,
      semanticCommitted: semanticSearchCommitted,
    },
    setters: {
      setQ: setSearchQuery,
      setPage: setCurrentPage,
      setLimit: setResultsPerPage,
      setPi: setSelectedPI,
      setIc: setSelectedIC,
      setOrg: setSelectedOrg,
      setActivity: setSelectedActivity,
      setState: setSelectedState,
      setFyMin,
      setFyMax,
      setProjectTerms: setProjectTermFilters,
      setSortOption,
      setColumnSort,
      setSemanticMode: setSemanticSearchMode,
      setSemanticCommitted: setSemanticSearchCommitted,
    },
  });

  const {
    results,
    loading,
    total,
    visibleTotal,
  } = useSearch({
    query: searchQuery,
    setQuery: setSearchQuery,
    projectTermFilters,
    excludeProjectTermFilters,
    selectedPI,
    selectedIC,
    selectedOrg,
    selectedActivity,
    selectedState,
    fyMin,
    fyMax,
    currentPage,
    resultsPerPage,
    sortBy,
    sortOrder,
    semanticMode: semanticSearchMode,
    semanticSearchCommitted,
    enabled: searchEnabled,
  });

  const { selectedProject, projectLoading, projectError } = useProjectDetails(
    selectedProjectId,
    results,
  );
  const { similarNeighbors, similarLoading, similarError } =
    useSimilarProjects(selectedProjectId);

  useEffect(() => {
    if (!selectedProjectId) return;
    void import("./components/project/ProjectDetailsPage");
  }, [selectedProjectId]);

  const {
    results: investigatorResults,
    loading: investigatorLoading,
    error: investigatorError,
    total: investigatorTotal,
    visibleTotal: investigatorVisibleTotal,
  } = useInvestigatorProjects(selectedInvestigatorName, investigatorPage);
  const {
    results: organizationResults,
    loading: organizationLoading,
    error: organizationError,
    total: organizationTotal,
    visibleTotal: organizationVisibleTotal,
  } = useOrganizationProjects(selectedOrganizationName, organizationPage);
  const {
    results: institutionResults,
    loading: institutionLoading,
    error: institutionError,
    total: institutionTotal,
    visibleTotal: institutionVisibleTotal,
  } = useInstitutionProjects(selectedInstitutionName, institutionPage);
  const investigatorTotalPages = Math.max(
    1,
    Math.ceil(investigatorVisibleTotal / ENTITY_LIST_PER_PAGE),
  );
  const investigatorPageNumbers = getPageNumbers(investigatorPage, investigatorTotalPages);
  const organizationTotalPages = Math.max(
    1,
    Math.ceil(organizationVisibleTotal / ENTITY_LIST_PER_PAGE),
  );
  const organizationPageNumbers = getPageNumbers(organizationPage, organizationTotalPages);
  const institutionTotalPages = Math.max(
    1,
    Math.ceil(institutionVisibleTotal / ENTITY_LIST_PER_PAGE),
  );
  const institutionPageNumbers = getPageNumbers(institutionPage, institutionTotalPages);

  const totalPages = Math.max(1, Math.ceil(visibleTotal / resultsPerPage));
  const pageNumbers = getPageNumbers(currentPage, totalPages);

  const searchFilterCatalog = useFilterCatalog();

  const appliedFilters = useMemo<FilterValues>(
    () => ({
      pi: selectedPI,
      ic: selectedIC,
      org: selectedOrg,
      activity: selectedActivity,
      state: selectedState,
      fyMin,
      fyMax,
    }),
    [selectedPI, selectedIC, selectedOrg, selectedActivity, selectedState, fyMin, fyMax],
  );

  const appliedFiltersRef = useRef(appliedFilters);
  appliedFiltersRef.current = appliedFilters;

  const filterCatalog = useMemo(
    () => ({
      icNames: searchFilterCatalog?.icNames ?? [],
      orgNames: searchFilterCatalog?.orgNames ?? [],
      activityCodes: searchFilterCatalog?.activityCodes ?? [],
      states: searchFilterCatalog?.states ?? [],
      fiscalYearOptions: searchFilterCatalog?.fiscalYearOptions,
    }),
    [searchFilterCatalog],
  );

  useEffect(() => {
    setJumpToPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    const mainElement = mainRef.current;

    const handleScroll = () => {
      const windowOffset = window.scrollY || document.documentElement.scrollTop || 0;
      const mainOffset = mainElement?.scrollTop ?? 0;
      setShowScrollTop(Math.max(windowOffset, mainOffset) > 550);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    mainElement?.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      mainElement?.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const handleSearch = (nextQuery: string) => {
    setSemanticSearchCommitted(semanticSearchMode);
    setSearchQuery(normalizeUnifiedSearch(nextQuery));
    setProjectTermFilters([]);
    setExcludeProjectTermFilters([]);
    setCurrentPage(1);
  };

  const handleSemanticModeChange = useCallback((enabled: boolean) => {
    setSemanticSearchMode(enabled);
    if (!enabled) {
      setSemanticSearchCommitted(false);
    }
  }, []);

  const activeSearchLabel = useMemo(
    () => normalizeUnifiedSearch(searchQuery).trim(),
    [searchQuery],
  );

  const handleDownloadCsv = useCallback(async (): Promise<void> => {
    setExportingCsv(true);
    setExportCsvError(null);
    try {
      const { plainQ, advanced } = parseUnifiedSearch(searchQuery);
      await downloadSearchResultsCsv(plainQ, {
        pi: selectedPI,
        ic: selectedIC,
        org: selectedOrg,
        activity: selectedActivity,
        state: selectedState,
        fyMin,
        fyMax,
        projectTerms: projectTermFilters,
        excludeProjectTerms: excludeProjectTermFilters,
        advancedSearch:
          advanced && hasAdvancedSearchContent(advanced) ? advanced : null,
      });
    } catch (err) {
      setExportCsvError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportingCsv(false);
    }
  }, [
    searchQuery,
    selectedPI,
    selectedIC,
    selectedOrg,
    selectedActivity,
    selectedState,
    fyMin,
    fyMax,
    projectTermFilters,
    excludeProjectTermFilters,
  ]);

  const handleApplyFilters = useCallback((filters: FilterValues) => {
    setFilterBreadcrumbOrder((order) =>
      updateFilterBreadcrumbOrder(order, appliedFiltersRef.current, filters),
    );
    setSelectedPI(filters.pi);
    setSelectedIC(filters.ic);
    setSelectedOrg(filters.org);
    setSelectedActivity(filters.activity);
    setSelectedState(filters.state);
    setFyMin(filters.fyMin);
    setFyMax(filters.fyMax);
    setCurrentPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilterBreadcrumbOrder([]);
    setSelectedPI("");
    setSelectedIC("");
    setSelectedOrg("");
    setSelectedActivity("");
    setSelectedState("");
    setFyMin("");
    setFyMax("");
    setProjectTermFilters([]);
    setExcludeProjectTermFilters([]);
    setColumnSort({ column: null, direction: "none" });
    setSortOption("relevant");
    setSearchQuery("");
    setSemanticSearchMode(false);
    setSemanticSearchCommitted(false);
    setCurrentPage(1);
  }, []);

  const handleDashboardQueryUpdate = useCallback((nextQuery: string) => {
    setSearchQuery(normalizeUnifiedSearch(nextQuery));
  }, []);

  const handleDashboardSearchNavigate = useCallback(
    (nextQuery: string, filters?: FilterValues) => {
      setSemanticSearchCommitted(semanticSearchMode);
      const unified = normalizeUnifiedSearch(nextQuery);
      const f = filters ?? appliedFilters;
      if (filters) {
        setSelectedPI(f.pi);
        setSelectedIC(f.ic);
        setSelectedOrg(f.org);
        setSelectedActivity(f.activity);
        setSelectedState(f.state);
        setFyMin(f.fyMin);
        setFyMax(f.fyMax);
      }
      setSearchQuery(unified);
      setProjectTermFilters([]);
      setExcludeProjectTermFilters([]);
      setCurrentPage(1);
      navigateToSearch({
        q: unified,
        pi: f.pi,
        ic: f.ic,
        org: f.org,
        activity: f.activity,
        state: f.state,
        fyMin: f.fyMin,
        fyMax: f.fyMax,
        projectTerms: [],
        page: 1,
        semanticMode: semanticSearchMode,
        semanticCommitted: semanticSearchMode,
      });
    },
    [navigateToSearch, appliedFilters, semanticSearchMode],
  );

  const handleDashboardTermSearchNavigate = useCallback(
    (terms: string[]) => {
      setProjectTermFilters(terms);
      setExcludeProjectTermFilters([]);
      setCurrentPage(1);
      navigateToSearch({ projectTerms: terms, page: 1 });
    },
    [navigateToSearch],
  );

  const handleViewAllProjects = useCallback(() => {
    setProjectTermFilters([]);
    setExcludeProjectTermFilters([]);
    setColumnSort({ column: null, direction: "none" });
    setSortOption("relevant");
    setSemanticSearchMode(false);
    setSemanticSearchCommitted(false);
    setCurrentPage(1);
    navigateToSearch({
      page: 1,
      projectTerms: [],
      semanticMode: false,
      semanticCommitted: false,
    });
  }, [navigateToSearch]);
  const handleDashboardYearSearchNavigate = useCallback(
    (year: number) => {
      const yearStr = String(year);
      setFyMin(yearStr);
      setFyMax(yearStr);
      setCurrentPage(1);
      navigateToSearch({
        fyMin: yearStr,
        fyMax: yearStr,
        page: 1,
      });
    },
    [navigateToSearch],
  );

  const handleSearchFromProjectTerms = useCallback(
    (payload: { terms: string[]; excludedTerms: string[]; additionalQuery: string }) => {
      setSemanticSearchMode(false);
      setSemanticSearchCommitted(false);
      setProjectTermFilters(payload.terms);
      setExcludeProjectTermFilters(payload.excludedTerms);
      const unified = normalizeUnifiedSearch(payload.additionalQuery);
      setSearchQuery(unified);
      setCurrentPage(1);
      navigateToSearch({
        q: unified,
        projectTerms: payload.terms,
        page: 1,
        semanticMode: false,
        semanticCommitted: false,
      });
    },
    [navigateToSearch],
  );

  const handleBackToList = useCallback(() => {
    navigateBackToList(navigate, location, navigateToSearch);
  }, [navigate, location, navigateToSearch]);

  const handlePerPageChange = useCallback((value: string) => {
    setResultsPerPage(Number(value));
    setCurrentPage(1);
  }, []);

  const handleSortOptionChange = useCallback((value: string) => {
    setSortOption(value as SortOption);
    setColumnSort({ column: null, direction: "none" });
    setCurrentPage(1);
  }, []);

  const handleColumnSortChange = useCallback((next: ResultsSortState) => {
    setColumnSort(next);
    setCurrentPage(1);
  }, []);

  const handleJumpToPageSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = Number.parseInt(jumpToPageInput, 10);
    if (!Number.isFinite(parsed)) {
      setJumpToPageInput(String(currentPage));
      return;
    }
    const boundedPage = Math.min(totalPages, Math.max(1, parsed));
    setCurrentPage(boundedPage);
    setJumpToPageInput(String(boundedPage));
  };

  const handleOpenDetails = (item: SearchResultRecord): void => {
    const projectId = item._id ?? item.id;
    if (!projectId) return;
    navigateToProject(
      navigate,
      projectId,
      getListReturnForProjectNavigation(location),
    );
  };
  const handleOpenInvestigator = (name: string): void => {
    setInvestigatorPage(1);
    navigate(`/investigators/${encodeURIComponent(name)}`);
  };
  const handleOpenOrganization = (name: string): void => {
    setOrganizationPage(1);
    navigate(`/organizations/${encodeURIComponent(name)}`);
  };
  const handleOpenInstitution = (name: string): void => {
    setInstitutionPage(1);
    navigate(`/institutions/${encodeURIComponent(name)}`);
  };

  const handleScrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
    mainRef.current?.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const isDashboardVisible = view === "dashboard" && !isSemanticRoute;
  const semanticReturnTo = useMemo(() => readReturnTo(location), [location]);
  const semanticBackIsProjectDetails = useMemo(
    () =>
      Boolean(
        semanticReturnTo?.pathname
        && matchPath("/projects/:projectId", semanticReturnTo.pathname),
      ),
    [semanticReturnTo],
  );
  const semanticBackLabel = semanticBackIsProjectDetails
    ? "Back to Project Details"
    : "Search results";
  const handleSemanticBack = useCallback(() => {
    if (semanticReturnTo) {
      navigate({
        pathname: semanticReturnTo.pathname,
        search: semanticReturnTo.search || undefined,
      });
      return;
    }
    navigate("/semantic");
  }, [navigate, semanticReturnTo]);

  const lastDashboardSearchRef = useRef(
    isDashboardRoute ? location.search : "",
  );
  const lastSearchSearchRef = useRef(
    isSearchRoute ? location.search : "",
  );

  useEffect(() => {
    if (isDashboardRoute) {
      lastDashboardSearchRef.current = location.search;
      return;
    }
    if (isSearchRoute) {
      lastSearchSearchRef.current = location.search;
    }
  }, [isDashboardRoute, isSearchRoute, location.search]);

  const handleNavigateToDashboard = useCallback(() => {
    const fallbackSearch = searchParamsToString(
      buildDashboardUrlParams({
        q: searchQuery,
        pi: selectedPI,
        ic: selectedIC,
        org: selectedOrg,
        activity: selectedActivity,
        state: selectedState,
        fyMin,
        fyMax,
        semantic: semanticSearchMode && semanticSearchCommitted,
      }),
    );
    const search = lastDashboardSearchRef.current || fallbackSearch;
    navigate({ pathname: "/", search });
  }, [
    navigate,
    searchQuery,
    selectedPI,
    selectedIC,
    selectedOrg,
    selectedActivity,
    selectedState,
    fyMin,
    fyMax,
    semanticSearchMode,
    semanticSearchCommitted,
  ]);

  const handleNavigateToSearchTopNav = useCallback(() => {
    const fallbackSearch = searchParamsToString(
      buildSearchUrlParams({
        q: searchQuery,
        page: currentPage,
        limit: resultsPerPage,
        pi: selectedPI,
        ic: selectedIC,
        org: selectedOrg,
        activity: selectedActivity,
        state: selectedState,
        fyMin,
        fyMax,
        projectTerms: projectTermFilters,
        sortBy,
        sortOrder,
        semantic: semanticSearchMode && semanticSearchCommitted,
      }),
    );
    const search = lastSearchSearchRef.current || fallbackSearch;
    navigate({ pathname: "/search", search });
  }, [
    navigate,
    searchQuery,
    currentPage,
    resultsPerPage,
    selectedPI,
    selectedIC,
    selectedOrg,
    selectedActivity,
    selectedState,
    fyMin,
    fyMax,
    projectTermFilters,
    sortBy,
    sortOrder,
    semanticSearchMode,
    semanticSearchCommitted,
  ]);

  return (
    <div className="grid grid-rows-[auto_minmax(0,1fr)] h-full overflow-hidden font-sans">
      <header className="bg-surface border-b border-border max-[900px]:grid max-[900px]:grid-cols-[1fr_auto] max-[900px]:grid-rows-[auto_auto] max-[900px]:items-center max-[900px]:gap-x-2 max-[900px]:gap-y-1.5 max-[900px]:px-3 max-[900px]:py-2 min-[901px]:grid min-[901px]:grid-cols-[1fr_auto_1fr] min-[901px]:items-center min-[901px]:px-6 min-[901px]:h-[50px] min-[901px]:gap-4">
        <button
          type="button"
          className="max-[900px]:col-start-1 max-[900px]:row-start-1 flex items-center gap-[0.4rem] font-semibold text-[14px] min-[901px]:text-[15px] text-text-primary bg-transparent border-none cursor-pointer tracking-[0.01em] shrink-0 justify-self-start hover:text-accent focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          onClick={handleNavigateToDashboard}
          aria-label="Return to dashboard"
        >
          <div className="w-[9px] h-[9px] rounded-full bg-accent shrink-0" />
          <span className="truncate">NIH Project Search</span>
        </button>
        <nav
          className="max-[900px]:col-span-2 max-[900px]:row-start-2 min-[901px]:col-start-2 min-[901px]:row-start-1 flex items-center justify-center gap-0.5 min-[901px]:gap-1 overflow-x-auto"
          aria-label="Main navigation"
        >
          <button
            type="button"
            className={
              "shrink-0 px-2 py-1 min-[901px]:px-3 min-[901px]:py-[0.35rem] rounded-sm border-none font-sans text-[12px] min-[901px]:text-[13px] font-medium cursor-pointer transition-[color,background] duration-150 hover:text-text-primary hover:bg-surface-hover" +
              (view === "dashboard" && !isSemanticRoute
                ? " text-accent-text bg-accent-light"
                : " bg-transparent text-text-muted")
            }
            onClick={handleNavigateToDashboard}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={
              "shrink-0 px-2 py-1 min-[901px]:px-3 min-[901px]:py-[0.35rem] rounded-sm border-none font-sans text-[12px] min-[901px]:text-[13px] font-medium cursor-pointer transition-[color,background] duration-150 hover:text-text-primary hover:bg-surface-hover" +
              ((isSearchRoute
                || selectedProjectId
                || selectedInvestigatorName
                || selectedOrganizationName
                || selectedInstitutionName) && !isSemanticRoute
                ? " text-accent-text bg-accent-light"
                : " bg-transparent text-text-muted")
            }
            onClick={handleNavigateToSearchTopNav}
          >
            Search
          </button>
          <button
            type="button"
            className={
              "shrink-0 px-2 py-1 min-[901px]:px-3 min-[901px]:py-[0.35rem] rounded-sm border-none font-sans text-[12px] min-[901px]:text-[13px] font-medium cursor-pointer transition-[color,background] duration-150 hover:text-text-primary hover:bg-surface-hover" +
              (isSemanticRoute
                ? " text-accent-text bg-accent-light"
                : " bg-transparent text-text-muted")
            }
            onClick={() => navigate("/semantic")}
          >
            <span className="min-[480px]:hidden">Hybrid</span>
            <span className="hidden min-[480px]:inline">Hybrid Search</span>
          </button>
        </nav>

        <div className="max-[900px]:col-start-2 max-[900px]:row-start-1 min-[901px]:col-start-3 min-[901px]:row-start-1 flex items-center justify-end gap-2 min-[901px]:gap-3 min-[901px]:justify-self-end">
          <button
            className="hidden min-[901px]:flex items-center gap-[0.4rem] px-[0.65rem] py-[0.3rem] rounded-sm bg-surface-hover border border-border text-text-secondary font-sans text-[12px] font-medium cursor-pointer transition-[color,border-color,background] duration-150 hover:border-border-strong hover:text-text-primary hover:bg-surface"
            type="button"
            onClick={handleThemeToggle}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? "Dark mode" : "Light mode"}
            <span className="text-sm" aria-hidden="true">
              {theme === "light" ? "🌙" : "☀️"}
            </span>
          </button>
          <button
            className="flex min-[901px]:hidden items-center justify-center size-8 rounded-sm bg-surface-hover border border-border text-text-secondary cursor-pointer transition-[color,border-color,background] duration-150 hover:border-border-strong hover:text-text-primary hover:bg-surface"
            type="button"
            onClick={handleThemeToggle}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            <span className="text-base leading-none" aria-hidden="true">
              {theme === "light" ? "🌙" : "☀️"}
            </span>
          </button>

          <div className="flex items-center gap-1.5 min-[901px]:gap-2" aria-label="Partner logos">
            <img
              src="/Images/KBR_logo.svg"
              alt="KBR logo"
              className="object-contain h-5 min-[901px]:h-[28px]"
            />
            <img
              src="/Images/FIU_logo.svg.png"
              alt="FIU logo"
              className="object-contain h-5 min-[901px]:h-[20px] min-[901px]:mt-2"
            />
          </div>
        </div>
      </header>

      <main
        ref={mainRef}
        className={
          "min-h-0 overflow-y-auto" +
          (isDashboardVisible ? "" : " p-[1.1rem_1.5rem] max-[900px]:px-3 max-[900px]:py-3")
        }
      >
        <ErrorBoundary>
          <Suspense fallback={
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center text-text-muted text-[0.92rem]" role="status">
              <span className="text-text-secondary text-sm">Loading…</span>
            </div>
          }>
            {isDashboardVisible ? (
              <Dashboard
                searchQuery={searchQuery}
                semanticMode={semanticSearchMode}
                onSemanticModeChange={handleSemanticModeChange}
                onUpdateDashboard={handleDashboardQueryUpdate}
                onSearchNavigate={handleDashboardSearchNavigate}
                appliedFilters={appliedFilters}
                filterBreadcrumbOrder={filterBreadcrumbOrder}
                onApplyFilters={handleApplyFilters}
                onClearFilters={handleClearFilters}
                onTermSearchNavigate={handleDashboardTermSearchNavigate}
                onViewAllProjects={handleViewAllProjects}
                onYearSearchNavigate={handleDashboardYearSearchNavigate}
                onOpenProject={(projectId) =>
                  navigateToProject(
                    navigate,
                    projectId,
                    getListReturnForProjectNavigation(location),
                  )
                }
              />
            ) : semanticSimilarProjectId ? (
              <SemanticSimilarProjectPage
                projectId={decodeURIComponent(semanticSimilarProjectId)}
                onBack={handleSemanticBack}
                backButtonLabel={semanticBackLabel}
                onOpenFullProject={(id) =>
                  navigateToProject(
                    navigate,
                    id,
                    getListReturnForProjectNavigation(location),
                  )
                }
                onOpenInvestigator={handleOpenInvestigator}
                onOpenOrganization={handleOpenOrganization}
                onOpenInstitution={handleOpenInstitution}
              />
            ) : isSemanticHub ? (
              <SemanticVectorLabPage />
            ) : selectedProjectId ? (
              projectError ? (
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center text-text-muted text-[0.92rem]" role="status" aria-live="polite">
                  <strong className="text-text-secondary text-[15px]">{projectError}</strong>
                  <BackToResultsButton
                    onClick={handleBackToList}
                    className="mt-[0.85rem]"
                  />
                </div>
              ) : !projectLoading && !selectedProject ? (
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center text-text-muted text-[0.92rem]" role="status" aria-live="polite">
                  <strong className="text-text-secondary text-[15px]">Project not found</strong>
                  <BackToResultsButton
                    onClick={handleBackToList}
                    className="mt-[0.85rem]"
                  />
                </div>
              ) : (
                <ProjectDetailsPage
                  item={selectedProject ?? stubProjectFromId(selectedProjectId)}
                  projectContentLoading={projectLoading && !selectedProject}
                  similarNeighbors={similarNeighbors}
                  similarLoading={similarLoading}
                  similarError={similarError}
                  onBack={handleBackToList}
                  onOpenInvestigator={handleOpenInvestigator}
                  onOpenOrganization={handleOpenOrganization}
                  onOpenInstitution={handleOpenInstitution}
                  onOpenDetails={handleOpenDetails}
                  onSearchWithProjectTerms={handleSearchFromProjectTerms}
                />
              )
            ) : selectedOrganizationName ? (
              <InvestigatorPage
                investigatorName={selectedOrganizationName}
                loading={organizationLoading}
                error={organizationError}
                results={organizationResults}
                visibleTotal={organizationVisibleTotal}
                total={organizationTotal}
                currentPage={organizationPage}
                totalPages={organizationTotalPages}
                pageNumbers={organizationPageNumbers}
                onOpenDetails={handleOpenDetails}
                onOpenInvestigator={handleOpenInvestigator}
                onOpenOrganization={handleOpenOrganization}
                onOpenInstitution={handleOpenInstitution}
                onPageChange={setOrganizationPage}
                onBack={handleBackToList}
              />
            ) : selectedInstitutionName ? (
              <InvestigatorPage
                investigatorName={selectedInstitutionName}
                loading={institutionLoading}
                error={institutionError}
                results={institutionResults}
                visibleTotal={institutionVisibleTotal}
                total={institutionTotal}
                currentPage={institutionPage}
                totalPages={institutionTotalPages}
                pageNumbers={institutionPageNumbers}
                onOpenDetails={handleOpenDetails}
                onOpenInvestigator={handleOpenInvestigator}
                onOpenOrganization={handleOpenOrganization}
                onOpenInstitution={handleOpenInstitution}
                onPageChange={setInstitutionPage}
                onBack={handleBackToList}
              />
            ) : selectedInvestigatorName ? (
              <InvestigatorPage
                investigatorName={selectedInvestigatorName}
                loading={investigatorLoading}
                error={investigatorError}
                results={investigatorResults}
                visibleTotal={investigatorVisibleTotal}
                total={investigatorTotal}
                currentPage={investigatorPage}
                totalPages={investigatorTotalPages}
                pageNumbers={investigatorPageNumbers}
                onOpenDetails={handleOpenDetails}
                onOpenInvestigator={handleOpenInvestigator}
                onOpenOrganization={handleOpenOrganization}
                onOpenInstitution={handleOpenInstitution}
                onPageChange={setInvestigatorPage}
                onBack={handleBackToList}
              />
            ) : isSearchRoute ? (
              <>
                <Filters
                  applied={appliedFilters}
                  catalog={filterCatalog}
                  fieldHelp={{
                    pi: HELP_SEARCH_FILTER_PI,
                    ic: HELP_SEARCH_FILTER_IC,
                    org: HELP_SEARCH_FILTER_ORG,
                    activity: HELP_SEARCH_FILTER_ACTIVITY,
                    state: HELP_SEARCH_FILTER_STATE,
                    fy: HELP_SEARCH_FILTER_FY,
                  }}
                  searchQuery={searchQuery}
                  semanticMode={semanticSearchMode}
                  onSemanticModeChange={handleSemanticModeChange}
                  showSemanticToggle
                  onSearch={handleSearch}
                  onApply={handleApplyFilters}
                  onClear={handleClearFilters}
                  helpTooltip={
                    <HelpTooltip label={HELP_SEARCH.label}>{HELP_SEARCH.body}</HelpTooltip>
                  }
                />

                <div className="pt-2 pl-1">
                  <div className="flex items-center gap-2 max-[900px]:gap-1.5 min-[901px]:justify-between min-[901px]:gap-4">
                    <div className="shrink-0 text-text-secondary text-sm max-[900px]:text-[11px] max-[900px]:leading-none min-[901px]:pt-[0.35rem]">
                      {loading ? (
                        <span>Searching…</span>
                      ) : (
                        <>
                          <span className="min-[901px]:hidden whitespace-nowrap">
                            <strong className="text-text-primary font-medium">
                              {visibleTotal.toLocaleString()}
                            </strong>{" "}
                            results
                          </span>
                          <span className="hidden min-[901px]:inline">
                            <strong className="text-text-primary font-medium">
                              {visibleTotal.toLocaleString()}
                            </strong>{" "}
                            results
                            {total > visibleTotal ? ` out of ${total.toLocaleString()}` : ""}
                            {activeSearchLabel ? ` for "${activeSearchLabel}"` : ""}
                            {(projectTermFilters.length > 0 || excludeProjectTermFilters.length > 0) && (
                              <span className="inline-flex flex-wrap items-center gap-[0.3rem] align-middle">
                                {" — "}
                                {projectTermFilters.map((term) => (
                                  <span key={`include-${term}`} className="inline-flex items-center gap-[0.2rem] px-[0.5rem] py-[0.2rem] rounded-md border border-accent-text/25 bg-accent-light text-accent-text text-[0.78rem] font-medium dark:border-accent/45">
                                    {term}
                                    <button
                                      type="button"
                                      className="bg-transparent border-none text-accent-text cursor-pointer text-[0.85rem] px-[0.15rem] py-0 leading-none opacity-70 hover:opacity-100"
                                      onClick={() =>
                                        setProjectTermFilters((prev) => prev.filter((t) => t !== term))
                                      }
                                      aria-label={`Remove ${term} filter`}
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                                {excludeProjectTermFilters.map((term) => (
                                  <span key={`exclude-${term}`} className="inline-flex items-center px-[0.5rem] py-[0.2rem] rounded-md border border-red-200/90 bg-red-50 text-red-700 text-[0.78rem] font-medium dark:border-red-900/50 dark:bg-red-950/45 dark:text-red-300">
                                    NOT {term}
                                    <button
                                      type="button"
                                      className="bg-transparent border-none text-red-700 dark:text-red-300 cursor-pointer text-[0.85rem] px-[0.15rem] py-0 leading-none opacity-70 hover:opacity-100"
                                      onClick={() =>
                                        setExcludeProjectTermFilters((prev) => prev.filter((t) => t !== term))
                                      }
                                      aria-label={`Remove NOT ${term} filter`}
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                                <button
                                  type="button"
                                  className="bg-transparent border-none text-accent-text cursor-pointer text-[0.78rem] underline px-[0.25rem] py-[0.15rem]"
                                  onClick={handleClearFilters}
                                >
                                  Clear all
                                </button>
                              </span>
                            )}
                            {currentPage > 1 ? ` — page ${currentPage} of ${totalPages}` : ""}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex min-w-0 flex-1 items-center gap-2 pb-[0.15rem] max-[900px]:gap-1.5 min-[901px]:w-auto min-[901px]:shrink-0 min-[901px]:flex-none min-[901px]:gap-4">
                      <button
                        type="button"
                        className={cn(
                          "box-border min-h-[2rem] shrink-0 rounded-sm border-2 border-border-input bg-bg px-[1rem] py-[0.5rem] font-sans text-[12px] leading-[1.35] text-text-primary outline-none transition-[border-color] duration-150",
                          "inline-flex items-center justify-center gap-[0.35rem] cursor-pointer hover:border-border-strong focus:border-accent",
                          "disabled:cursor-not-allowed disabled:opacity-50",
                          "max-[900px]:px-2.5 max-[900px]:text-[11px]",
                        )}
                        onClick={() => void handleDownloadCsv()}
                        disabled={loading || exportingCsv || visibleTotal === 0}
                        title="Download up to 10,000 matching rows with all original columns"
                        aria-label={exportingCsv ? "Preparing CSV download" : "Download search results as CSV"}
                        aria-busy={exportingCsv}
                      >
                        {exportingCsv && (
                          <span
                            className="inline-block size-3 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        {exportingCsv ? "Preparing CSV…" : "Download CSV"}
                      </button>
                      <div className="flex min-w-0 flex-1 items-center gap-2 max-[900px]:gap-1.5 min-[901px]:min-w-[19.5rem] min-[901px]:flex-none">
                        <div className="min-w-0 flex-1">
                          <FilterSelect
                            compact
                            includeEmptyOption={false}
                            truncateSelectedLabel
                            value={sortOption}
                            onChange={handleSortOptionChange}
                            options={SORT_SELECT_OPTIONS}
                            placeholder="Sort"
                            ariaLabel="Sort results"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <FilterSelect
                            compact
                            includeEmptyOption={false}
                            truncateSelectedLabel
                            value={String(resultsPerPage)}
                            onChange={handlePerPageChange}
                            options={PER_PAGE_SELECT_OPTIONS}
                            placeholder="Per page"
                            ariaLabel="Results per page"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {!loading &&
                  (total > visibleTotal
                    || activeSearchLabel
                    || currentPage > 1
                    || projectTermFilters.length > 0
                    || excludeProjectTermFilters.length > 0) ? (
                    <div className="min-[901px]:hidden mt-1 text-[11px] leading-snug text-text-secondary">
                      {total > visibleTotal ? <span>{` out of ${total.toLocaleString()}`}</span> : null}
                      {activeSearchLabel ? <span>{` for "${activeSearchLabel}"`}</span> : null}
                      {currentPage > 1 ? <span>{` · page ${currentPage} of ${totalPages}`}</span> : null}
                      {(projectTermFilters.length > 0 || excludeProjectTermFilters.length > 0) && (
                        <span className="mt-1 inline-flex flex-wrap items-center gap-[0.3rem]">
                          {projectTermFilters.map((term) => (
                            <span key={`mobile-include-${term}`} className="inline-flex items-center gap-[0.2rem] px-[0.5rem] py-[0.2rem] rounded-md border border-accent-text/25 bg-accent-light text-accent-text text-[0.78rem] font-medium dark:border-accent/45">
                              {term}
                              <button
                                type="button"
                                className="bg-transparent border-none text-accent-text cursor-pointer text-[0.85rem] px-[0.15rem] py-0 leading-none opacity-70 hover:opacity-100"
                                onClick={() =>
                                  setProjectTermFilters((prev) => prev.filter((t) => t !== term))
                                }
                                aria-label={`Remove ${term} filter`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          {excludeProjectTermFilters.map((term) => (
                            <span key={`mobile-exclude-${term}`} className="inline-flex items-center px-[0.5rem] py-[0.2rem] rounded-md border border-red-200/90 bg-red-50 text-red-700 text-[0.78rem] font-medium dark:border-red-900/50 dark:bg-red-950/45 dark:text-red-300">
                              NOT {term}
                              <button
                                type="button"
                                className="bg-transparent border-none text-red-700 dark:text-red-300 cursor-pointer text-[0.85rem] px-[0.15rem] py-0 leading-none opacity-70 hover:opacity-100"
                                onClick={() =>
                                  setExcludeProjectTermFilters((prev) => prev.filter((t) => t !== term))
                                }
                                aria-label={`Remove NOT ${term} filter`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          <button
                            type="button"
                            className="bg-transparent border-none text-accent-text cursor-pointer text-[0.78rem] underline px-[0.25rem] py-[0.15rem]"
                            onClick={handleClearFilters}
                          >
                            Clear all
                          </button>
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>

                {exportCsvError && (
                  <p className="text-[0.78rem] text-text-muted m-0 px-1" role="alert">
                    {exportCsvError}
                  </p>
                )}

                <div className="mt-1.75">
                  <ResultsList
                    results={results}
                    primarySort={sortOption}
                    loading={loading}
                    showSimilarityScore={
                      semanticSearchMode && semanticSearchCommitted
                    }
                    onOpenDetails={handleOpenDetails}
                    onOpenInvestigator={handleOpenInvestigator}
                    onOpenOrganization={handleOpenOrganization}
                    onOpenInstitution={handleOpenInstitution}
                    sort={columnSort}
                    onSortChange={
                      semanticSearchMode && semanticSearchCommitted
                        ? undefined
                        : handleColumnSortChange
                    }
                  />
                </div>

                {totalPages > 1 && (
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    pageNumbers={pageNumbers}
                    onPageChange={setCurrentPage}
                    jumpToPageInput={jumpToPageInput}
                    onJumpToPageInputChange={setJumpToPageInput}
                    onJumpToPageSubmit={handleJumpToPageSubmit}
                  />
                )}

                {showScrollTop && (
                  <button
                    type="button"
                    className="fixed right-8 bottom-6 border border-accent bg-accent text-white rounded-sm px-[0.92rem] py-[0.575rem] font-sans text-[15px] font-medium cursor-pointer shadow-md transition-[background,transform] duration-150 hover:bg-accent-hover hover:-translate-y-0.5 max-[900px]:right-4 max-[900px]:bottom-3"
                    onClick={handleScrollToTop}
                    aria-label="Scroll back to top"
                  >
                    ↑
                  </button>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center text-text-muted text-[0.92rem]" role="status">
                <strong className="text-text-secondary text-[15px]">Page not found</strong>
                <p className="mt-2 text-sm">The page you're looking for doesn't exist.</p>
                <button
                  type="button"
                  className="mt-4 px-4 py-2 rounded-sm bg-accent text-white border-none font-sans text-sm font-medium cursor-pointer hover:bg-accent-hover transition-[background] duration-150"
                  onClick={() => navigate("/")}
                >
                  Go to Dashboard
                </button>
              </div>
            )}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
