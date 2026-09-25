import { Prisma } from "@prisma/client";
import { prisma } from "../db";

export interface DailyPoint {
  date: string; // YYYY-MM-DD (UTC)
  count: number;
}

const ALL_STATUSES = [
  "PENDING",
  "ID_UPLOADED",
  "VISUALLY_VERIFIED",
  "VISUALLY_REJECTED",
  "MANUALLY_VERIFIED",
  "MANUALLY_REJECTED",
  "EXPIRED",
] as const;

/** Count of requests per status, with zeroes for statuses that have none. */
export async function statusBreakdown(businessId?: string): Promise<Record<string, number>> {
  const rows = await prisma.verificationRequest.groupBy({
    by: ["status"],
    where: businessId ? { businessId } : undefined,
    _count: { _all: true },
  });
  const out: Record<string, number> = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
  for (const row of rows) out[row.status] = row._count._all;
  return out;
}

/** Requests created per day for the last `days` days (including today), zero-filled. */
export async function dailyRequestSeries(days: number, businessId?: string): Promise<DailyPoint[]> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const rows = await prisma.$queryRaw<{ day: Date; count: bigint }[]>(Prisma.sql`
    SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*) AS count
    FROM "VerificationRequest"
    WHERE "createdAt" >= ${start}
    ${businessId ? Prisma.sql`AND "businessId" = ${businessId}` : Prisma.empty}
    GROUP BY 1
  `);

  const byDay = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.count)]));
  const series: DailyPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, count: byDay.get(key) ?? 0 });
  }
  return series;
}

/**
 * Share of requests where the customer actually submitted their ID
 * (anything beyond PENDING/EXPIRED), as a 0-1 fraction; null when there are no requests.
 */
export function completionRate(byStatus: Record<string, number>): number | null {
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const abandoned = (byStatus.PENDING ?? 0) + (byStatus.EXPIRED ?? 0);
  return (total - abandoned) / total;
}
