/**
 * @file StatCard.tsx
 * @description A reusable React component that displays a statistic with a label, value, icon, and optional trend information. It is designed to be used in dashboards or analytics pages to present key metrics in a visually appealing way. The component also supports showing raw values as tooltips on hover for more detailed information.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import type { LucideIcon } from "lucide-react";
import { Tip } from "./Tip";
import { StatValueSkeleton } from "./Skeleton";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  accentColor?: string;
  /** Raw value shown as custom tooltip on hover */
  raw?: string;
  /** When true, render skeletons in place of value/trend so the UI never
   *  flashes "-" or "0" before real data arrives. */
  loading?: boolean;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  accentColor = "text-amber-700 dark:text-accent",
  raw,
  loading = false,
}: StatCardProps) {
  return (
    <div className="bg-white dark:bg-surface-2 border border-gray-100 dark:border-border shadow-sm dark:shadow-none hover:shadow-md transition-shadow duration-200 rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">
          {label}
        </span>
        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
          <Icon className={`w-4 h-4 ${accentColor}`} />
        </div>
      </div>
      <div className="flex items-end gap-2 min-w-0">
        {loading ? (
          <StatValueSkeleton />
        ) : (
          <Tip raw={raw}>
            <span className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums leading-none truncate">
              {value}
            </span>
          </Tip>
        )}
        {!loading && trend && (
          <span className="text-sm text-gray-500 dark:text-gray-400 mb-0.5 flex-shrink-0">
            {trend}
          </span>
        )}
      </div>
    </div>
  );
}
