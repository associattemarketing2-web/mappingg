// Which blog guides belong on a locality or city page. A guide matches when its
// slug contains the place's slug as whole words ("new-projects-in-kharadi-pune"
// matches "kharadi", but not "khar"). Linking the live list and the written
// guide to each other keeps them complementary instead of competing.

export interface GuidePost { slug: string; title: string }

export function guidesFor<T extends GuidePost>(placeSlug: string, posts: T[], max = 3): T[] {
  if (!placeSlug) return [];
  const needle = `-${placeSlug}-`;
  return posts.filter((p) => `-${p.slug}-`.includes(needle)).slice(0, max);
}
