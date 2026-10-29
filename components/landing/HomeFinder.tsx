import type { ProjectCardData } from '@/lib/home/cards';
import { localityOptions } from '@/lib/home/nearby';
import NearbyProjects from './NearbyProjects';
import ProjectQuickView from './ProjectQuickView';

// Home page section under the live map: "Projects near you" (by location or a
// chosen locality) and the "Enquire now" popup its cards open. The locality
// list comes from the same cached project cards the rest of the site uses.
export default function HomeFinder({ cards }: { cards: ProjectCardData[] }) {
  const localities = localityOptions(cards, undefined, 3).slice(0, 80);
  return (
    <div className="hf">
      <div className="hf-wrap">
        <NearbyProjects localities={localities} />
      </div>
      {/* The "Enquire now" popup for the cards above. */}
      <ProjectQuickView />
    </div>
  );
}
