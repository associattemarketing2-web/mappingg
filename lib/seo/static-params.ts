// generateStaticParams for the DB-backed hub pages. If the database can't be
// reached during a build, pre-render none of them instead of failing the deploy:
// with dynamicParams = true each page renders on its first visit and ISR keeps it.
export async function staticParamsOr<T>(page: string, load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load();
  } catch (e) {
    console.warn(`[build] ${page}: database not reachable, pages will render on first visit (${(e as Error).message})`);
    return [];
  }
}
