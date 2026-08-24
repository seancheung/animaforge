import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...values: ClassValue[]) => twMerge(clsx(values));

const englishCompactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
export const formatCompactNumber = (value: number) => englishCompactNumber.format(value);
export const formatDollarAmount = (value: number, locale: string) =>
  `$${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)}`;

export const formatDate = (value: string, locale: string, emptyLabel: string) => {
  if (!value) return emptyLabel;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};
