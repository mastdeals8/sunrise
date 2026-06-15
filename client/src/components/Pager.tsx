import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Shared pagination control (Phase 2 hardening).
 * Works for both server-driven pagination (pass total from X-Total-Count)
 * and client-side slicing of an already-loaded list.
 */
export const Pager: React.FC<{
  page: number;            // zero-based
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}> = ({ page, pageSize, total, onPageChange, className }) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className={`flex items-center justify-between gap-2 py-2 ${className || ""}`}>
      <span className="text-xs text-slate-500">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="h-7 px-2 inline-flex items-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs px-1">
          {page + 1}/{pageCount}
        </span>
        <button
          type="button"
          className="h-7 px-2 inline-flex items-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

/** Client-side pagination hook for already-loaded lists. */
export const usePagedList = <T,>(list: T[], pageSize = 25) => {
  const [page, setPage] = React.useState(0);
  React.useEffect(() => {
    // Clamp when the list shrinks (e.g. after filtering/deleting).
    const max = Math.max(0, Math.ceil(list.length / pageSize) - 1);
    if (page > max) setPage(max);
  }, [list.length, page, pageSize]);
  const slice = React.useMemo(
    () => list.slice(page * pageSize, (page + 1) * pageSize),
    [list, page, pageSize]
  );
  return { page, setPage, slice, total: list.length, pageSize };
};
