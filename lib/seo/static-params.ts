// generateStaticParams for the DB-backed hub pages. If the database can't be
// reached during a build, pre-render none of them instead of failing the deploy:
// with dynamicParams = true each page renders on its first visit and ISR keeps it.
//
// A database that hangs (rather than failing fast) is treated the same way: Next
// kills "collecting page data" after 60s per attempt and fails the whole build
// ("Collecting page data for /developers/[slug] is still timing out"), so give up
// well before that.
const BUDGET_MS = 25_000;

export async function staticParamsOr<T>(page: string, load: () => Promise<T[]>): Promise<T[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${BUDGET_MS / 1000}s`)), BUDGET_MS);
  });
  try {
    return await Promise.race([load(), timeout]);
  } catch (e) {
    console.warn(`[build] ${page}: database not reachable, pages will render on first visit (${(e as Error).message})`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
