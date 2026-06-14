import { type FormEvent } from "react";
import { cn } from "../../utils/cn";

type PaginationProps = {
  currentPage: number;
  totalPages: number;
  pageNumbers: Array<number | "...">;
  onPageChange: (page: number) => void;
  jumpToPageInput?: string;
  onJumpToPageInputChange?: (value: string) => void;
  onJumpToPageSubmit?: (e: FormEvent<HTMLFormElement>) => void;
};

const btnPage =
  "min-w-[34px] h-[34px] px-2 border border-border rounded-sm bg-surface text-text-secondary font-sans text-[15px] cursor-pointer transition-all duration-100 flex items-center justify-center hover:not-disabled:border-border-strong hover:not-disabled:text-text-primary hover:not-disabled:bg-surface-hover disabled:opacity-40 disabled:cursor-default";

const btnPageActive =
  "min-w-[34px] h-[34px] px-2 border border-accent rounded-sm bg-accent text-white font-sans text-[15px] font-medium cursor-default flex items-center justify-center opacity-40 disabled:opacity-40";

/**
 * Computes the page number list to display in pagination, inserting an ellipsis
 * when there is a gap between the visible window and the last page.
 *
 * @param page - The current active page (1-based).
 * @param totalPageCount - The total number of pages.
 * @returns An ordered array of page numbers and "..." sentinel strings.
 */
export function getPageNumbers(page: number, totalPageCount: number): Array<number | "..."> {
  if (totalPageCount <= 5) {
    return Array.from({ length: totalPageCount }, (_, i) => i + 1);
  }
  const start = Math.max(1, page);
  const end = Math.min(totalPageCount, start + 2);
  const pages: Array<number | "..."> = [];

  for (let p = start; p <= end; p++) {
    pages.push(p);
  }
  if (end < totalPageCount - 1) {
    pages.push("...");
  }
  if (end < totalPageCount) {
    pages.push(totalPageCount);
  }

  return pages;
}

/**
 * Shared pagination control used across search results and investigator pages.
 *
 * Renders first/prev/page-number/next/last buttons and an optional jump-to-page
 * form. Jump-to-page is omitted when the three handler props are not provided.
 */
export default function Pagination({
  currentPage,
  totalPages,
  pageNumbers,
  onPageChange,
  jumpToPageInput,
  onJumpToPageInputChange,
  onJumpToPageSubmit,
}: PaginationProps) {
  const hasJumpToPage =
    jumpToPageInput !== undefined &&
    onJumpToPageInputChange !== undefined &&
    onJumpToPageSubmit !== undefined;

  return (
    <div className="flex items-center gap-1 mt-6 flex-wrap">
      <button
        type="button"
        className={btnPage}
        onClick={() => onPageChange(1)}
        disabled={currentPage === 1}
        aria-label="Go to first page"
      >
        «
      </button>

      <button
        type="button"
        className={btnPage}
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
        aria-label="Go to previous page"
      >
        ←
      </button>

      {pageNumbers.map((item, index) =>
        item === "..." ? (
          <span key={`ellipsis-${index}`} className="text-text-muted text-[13px] px-1">…</span>
        ) : (
          <button
            key={item}
            type="button"
            className={item === currentPage ? btnPageActive : btnPage}
            onClick={() => onPageChange(item as number)}
            disabled={item === currentPage}
            aria-label={`Go to page ${item}`}
            aria-current={item === currentPage ? "page" : undefined}
          >
            {item}
          </button>
        ),
      )}

      <button
        type="button"
        className={btnPage}
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage >= totalPages}
        aria-label="Go to next page"
      >
        →
      </button>

      <button
        type="button"
        className={btnPage}
        onClick={() => onPageChange(totalPages)}
        disabled={currentPage >= totalPages}
        aria-label="Go to last page"
      >
        »
      </button>

      {hasJumpToPage && (
        <form className="inline-flex items-center gap-1 ml-0 min-[901px]:ml-8 max-[900px]:w-full max-[900px]:mt-1" onSubmit={onJumpToPageSubmit}>
          <input
            className="w-14 h-[34px] border border-border rounded-sm bg-surface text-text-primary font-sans text-[13px] text-center px-[0.35rem] focus:outline-2 focus:outline-accent/40 focus:outline-offset-1 focus:border-accent"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={jumpToPageInput}
            onChange={(e) => onJumpToPageInputChange(e.target.value.replace(/\D/g, ""))}
            aria-label={`Jump to page between 1 and ${totalPages}`}
          />
          <button type="submit" className={cn(btnPage, "min-w-[44px]")}>
            Go
          </button>
        </form>
      )}
    </div>
  );
}
