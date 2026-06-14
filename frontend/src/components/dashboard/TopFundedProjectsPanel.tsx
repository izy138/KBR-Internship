import { cn } from "../../utils/cn";
import type { TopFundedProject } from "../../api";
import { CLS_DASHBOARD_PANEL_HEADER, CLS_DASHBOARD_PANEL_SHELL } from "../../utils/chartStyles";
import { formatDollarsFull } from "../../utils/format";

type TopFundedProjectsPanelProps = {
  projects: TopFundedProject[];
  loading?: boolean;
  onOpenProject?: (projectId: string) => void;
};

function FiscalYearMeta({ project }: { project: TopFundedProject }) {
  if (project.fy == null) return null;

  const label = project.fy_has_duplicates ? `${project.fy} +` : String(project.fy);
  const otherYears = project.other_fiscal_years ?? [];
  const showTooltip = otherYears.length > 0 || project.fy_has_duplicates;
  const tooltipLines: string[] = [];

  if (project.fy_has_duplicates) {
    const count = project.duplicate_fy_count ?? 2;
    tooltipLines.push(
      `${count} award${count === 1 ? "" : "s"} in FY ${project.fy}`,
    );
  }
  if (otherYears.length > 0) {
    tooltipLines.push(`Other years: ${otherYears.join(", ")}`);
  }

  return (
    <span className="relative shrink-0 group/fy">
      <span
        className={cn(
          showTooltip
            && "cursor-default underline decoration-dotted decoration-text-muted underline-offset-2",
        )}
      >
        {label}
      </span>
      {showTooltip ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-[calc(100%+0.25rem)] left-1/2 z-30 hidden min-w-[8.5rem] max-w-[min(13rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-[0.6875rem] leading-snug text-text-secondary shadow-md group-hover/fy:block group-focus-within/fy:block"
        >
          {tooltipLines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function MetaSegments({ project }: { project: TopFundedProject }) {
  const activity = project.activity?.trim();
  const state = project.state?.trim();

  if (!activity && !state && project.fy == null) {
    return null;
  }

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 truncate text-[0.6875rem] font-medium text-text-secondary">
      {activity ? <span className="truncate">{activity}</span> : null}
      {activity && state ? (
        <span className="shrink-0" aria-hidden>
          ·
        </span>
      ) : null}
      {state ? <span className="shrink-0">{state}</span> : null}
      {(activity || state) && project.fy != null ? (
        <span className="shrink-0" aria-hidden>
          ·
        </span>
      ) : null}
      <FiscalYearMeta project={project} />
    </span>
  );
}

function ProjectCard({
  project,
  rank,
  onOpenProject,
}: {
  project: TopFundedProject;
  rank: number;
  onOpenProject?: (projectId: string) => void;
}) {
  const fundingDisplay = formatDollarsFull(project.total_funding);
  const instituteLabel = project.institute?.trim() || "—";
  const organizationLabel = project.organization?.trim() || "—";
  const clickable = Boolean(onOpenProject && project.project_id);
  const otherYears = project.other_fiscal_years ?? [];
  const yearNote =
    otherYears.length > 0
      ? `; other fiscal years: ${otherYears.join(", ")}`
      : project.fy_has_duplicates
        ? `; ${project.duplicate_fy_count ?? 2} awards in FY ${project.fy}`
        : "";

  const body = (
    <>
      <div className="flex items-start gap-1.5 min-w-0">
        <span
          className="shrink-0 font-mono text-[0.6875rem] font-semibold text-accent tabular-nums leading-none pt-px"
          aria-hidden
        >
          {rank}
        </span>
        <div className="flex min-w-0 flex-1 items-start justify-end gap-1.5">
          <MetaSegments project={project} />
          <span className="shrink-0 font-mono text-[0.8125rem] font-semibold text-text-primary whitespace-nowrap leading-none pt-px">
            {fundingDisplay}
          </span>
        </div>
      </div>
      <h3
        className="mt-0.5 text-[0.8125rem] font-semibold leading-tight text-text-primary line-clamp-1"
        title={project.title}
      >
        {project.title}
      </h3>
      <div className="mt-1 flex min-w-0 items-center gap-1 text-[0.6875rem] leading-none text-text-muted">
        <span className="min-w-0 flex-1 truncate" title={instituteLabel}>
          {instituteLabel}
        </span>
        <span className="shrink-0 text-border-strong" aria-hidden>
          ·
        </span>
        <span className="min-w-0 flex-1 truncate" title={organizationLabel}>
          {organizationLabel}
        </span>
      </div>
    </>
  );

  const cardClass = cn(
    "flex min-h-0 flex-col rounded-md border border-border bg-bg px-2 py-1.5 text-left",
    clickable
      && "cursor-pointer transition-[border-color,background,box-shadow] duration-150 hover:border-accent hover:bg-surface-hover hover:shadow-sm focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
  );

  const ariaLabel = `${project.title}; ${instituteLabel}; ${organizationLabel}; ${fundingDisplay}${yearNote}. View project details`;

  if (!clickable) {
    return <article className={cardClass}>{body}</article>;
  }

  return (
    <button
      type="button"
      className={cardClass}
      onClick={() => onOpenProject?.(project.project_id)}
      aria-label={ariaLabel}
    >
      {body}
    </button>
  );
}

export default function TopFundedProjectsPanel({
  projects,
  loading = false,
  onOpenProject,
}: TopFundedProjectsPanelProps) {
  const slots = Array.from({ length: 15 }, (_, index) => projects[index] ?? null);

  return (
    <section
      className={cn(
        CLS_DASHBOARD_PANEL_SHELL,
        "pb-[0.9rem]",
        loading && "opacity-80",
      )}
      aria-busy={loading}
    >
      <div className={CLS_DASHBOARD_PANEL_HEADER}>Top Funded Projects</div>
      <div
        className="grid grid-cols-3 grid-rows-5 gap-2 min-h-0 max-[900px]:grid-cols-2 max-[900px]:grid-rows-none max-[500px]:grid-cols-1"
        role="list"
        aria-label="Top funded projects"
      >
        {projects.length === 0 && !loading ? (
          <p className="col-span-full flex items-center justify-center text-sm text-text-muted text-center py-8">
            No projects match the current filters.
          </p>
        ) : (
          slots.map((project, index) =>
            project ? (
              <ProjectCard
                key={`${project.project_id}-${project.fy ?? "na"}`}
                project={project}
                rank={index + 1}
                onOpenProject={onOpenProject}
              />
            ) : (
              <div
                key={`empty-${index}`}
                className="min-h-[3.75rem] rounded-md border border-dashed border-border/80 bg-bg/50"
                aria-hidden
              />
            ),
          )
        )}
      </div>
    </section>
  );
}
