// Hand-written area guides for the 15 Pune/MMR localities with the most useful
// inventory on Mappingg (chosen 13 Oct 2026 from live project counts and data
// completeness; see seo-doc/THIN-PAGES-2026-10-13.md).
//
// Rules for this file: describe only well-established facts about where an area
// is and what defines it (IT parks, stations, metro lines that exist). No prices,
// project counts, appreciation or "investment return" claims — those come live
// from the project data (lib/seo/locality-summary.ts) so they never go stale.
// A locality with a guide stays indexable even with fewer than 3 projects.

export interface LocalityGuide { intro: string[] }

export const LOCALITY_GUIDES: Record<string, LocalityGuide> = {
  mundhwa: { intro: [
    'Mundhwa is in east Pune, along the Mula-Mutha river, with Koregaon Park and Kalyani Nagar on one side and Kharadi, Magarpatta and Hadapsar on the others. Its North Main Road side (often called the KP Annexe) shares Koregaon Park\'s restaurants and schools, while the Magarpatta side is close to Cybercity and Amanora.',
    'It is the busiest micro-market on Mappingg, with everything from compact homes and family 3–4 BHKs to large-format apartments, villas and office space, much of it by well-known Pune developers. Because Mundhwa is spread out, check each project\'s exact position on the live map before you shortlist.',
  ] },
  kharadi: { intro: [
    'Kharadi is on the Nagar Road side of east Pune, next to Viman Nagar, Wagholi and Mundhwa. It grew around the EON IT Park and World Trade Center Pune, which makes it one of the city\'s main office hubs, and Pune airport in Lohegaon is a short drive away.',
    'New supply here is mostly 2–4 BHK apartments in larger gated projects, with some premium towers, villas and commercial space. Upper Kharadi (towards Wagholi) and Central Kharadi near the river can differ a lot in price and commute, so compare projects on the map.',
  ] },
  magarpatta: { intro: [
    'Magarpatta is the integrated township built by Magarpatta Group on the Hadapsar side of east Pune, around the Cybercity IT park, with its own schools, hospital, malls and open spaces. Projects listed under Magarpatta here include the township and its surroundings on Magarpatta Road towards Mundhwa.',
    'It suits buyers who want to live close to work in a planned neighbourhood. Listings range from 2–3 BHK homes to large luxury residences, plotted bungalows and office space.',
  ] },
  hinjewadi: { intro: [
    'Hinjewadi is in west Pune and is home to the Rajiv Gandhi Infotech Park, Pune\'s largest IT cluster, spread over several phases. It is next to Wakad, Tathawade and Mahalunge and connects to the Mumbai–Bengaluru highway.',
    'Most new homes here are 2, 3 and larger BHK apartments in big townships aimed at people working in the IT park. Traffic at peak hours is a real factor, so look at how close a project is to your phase of the park.',
  ] },
  kalyan: { intro: [
    'Kalyan is in Thane district, part of the Kalyan-Dombivli Municipal Corporation, and Kalyan Junction is one of the busiest stations on Mumbai\'s Central Railway. Many of the projects tracked here are on the Kalyan–Shil Road corridor towards Dombivli and Navi Mumbai, where several large townships are coming up.',
    'It is one of the more affordable parts of the Mumbai Metropolitan Region for new homes, with 1, 2 and 3 BHK apartments alongside larger homes and commercial space in township projects.',
  ] },
  andheri: { intro: [
    'Andheri is a large western suburb of Mumbai, split by the Western Railway line into Andheri West and Andheri East. Andheri East is home to SEEPZ and the MIDC business district and is next to Mumbai\'s international airport, while Andheri West is largely residential and commercial.',
    'Projects here include redevelopment towers with compact studios, 1 BHK and "jodi" (combined) apartments as well as larger homes. Many listings do not publish prices yet, so ask the developer for a price sheet and check each tower\'s MahaRERA registration.',
  ] },
  balewadi: { intro: [
    'Balewadi is in west Pune next to Baner, and is known for the Shree Shiv Chhatrapati Sports Complex. It sits between Baner, Mahalunge and the Mumbai–Bengaluru highway, with Hinjewadi to the west.',
    'New projects here are mainly premium 2, 3 and 4 BHK apartments, including large-format homes. It suits buyers who want west Pune\'s newer residential belt with easy access to both Hinjewadi and the city.',
  ] },
  kothrud: { intro: [
    'Kothrud is one of west Pune\'s most established residential neighbourhoods, with Pune Metro\'s Vanaz–Ramwadi line running along Paud Road. It has long-standing schools, colleges and markets, and new supply comes mostly from redevelopment of older buildings.',
    'Listings here include 2–4 BHK apartments, some large luxury homes and retail space on main roads. Because many projects are redevelopments on smaller plots, compare amenities and parking carefully.',
  ] },
  dombivli: { intro: [
    'Dombivli is in Thane district, part of the Kalyan-Dombivli Municipal Corporation, with its own station on Mumbai\'s Central Railway line. Several projects tracked here are in Dombivli East and on the Kalyan–Shil Road corridor.',
    'It is one of the more affordable places in the Mumbai region to buy a new home, with mostly 1 and 2 BHK apartments and some 3 BHK homes, including ready towers inside larger townships.',
  ] },
  hadapsar: { intro: [
    'Hadapsar is in south-east Pune on the Pune–Solapur highway, next to Magarpatta, Amanora and Mundhwa. It combines an older industrial area with newer residential projects and townships.',
    'Homes here range from compact 1 and 2 BHK apartments to large premium homes, with some ready-to-move options. It suits buyers working in Magarpatta, Kharadi or the Solapur Road belt.',
  ] },
  wakad: { intro: [
    'Wakad is in north-west Pune along the Mumbai–Bengaluru highway, between Hinjewadi, Pimple Saudagar and Tathawade, and falls under the Pimpri-Chinchwad municipal area. It is popular with people working in Hinjewadi who want quicker access to the highway.',
    'New supply here is mostly 2 and 3 BHK apartments, with some larger homes and duplexes in newer towers.',
  ] },
  kharghar: { intro: [
    'Kharghar is a planned node of Navi Mumbai developed by CIDCO, known for its Central Park and green hills, and served by Navi Mumbai Metro Line 1 and the Harbour line. It is close to Belapur, Taloja and Panvel.',
    'Projects here range from 1 and 2 BHK homes in Upper Kharghar to larger 2–4 BHK apartments. As in much of Navi Mumbai, check whether the land is CIDCO leasehold.',
  ] },
  dhanori: { intro: [
    'Dhanori is in north-east Pune, next to Vishrantwadi, Lohegaon and Pune airport. It has grown quickly as a residential area for people working in Viman Nagar, Kharadi and on Nagar Road.',
    'New projects are mainly 2 and 3 BHK apartments, with some 1 and 4 BHK options, often at lower prices than nearby Viman Nagar.',
  ] },
  lohegaon: { intro: [
    'Lohegaon is in north-east Pune and is where Pune International Airport is located. It borders Dhanori, Viman Nagar and Wagholi.',
    'Projects here are mostly affordable and mid-range 2 BHK apartments, with some 1 and 3 BHK homes. Check flight paths and airport-related building rules for any project close to the runway.',
  ] },
  'koregaon-park': { intro: [
    'Koregaon Park is one of Pune\'s best-known premium residential areas, close to the city centre and Pune railway station, with tree-lined lanes, restaurants and North Main Road. It borders Kalyani Nagar, Mundhwa and Bund Garden.',
    'New homes here are few and mostly large luxury apartments, so supply is limited and prices are among the highest in Pune. Many projects are invite-only or price on request.',
  ] },
};

export const hasLocalityGuide = (slug: string): boolean => Object.prototype.hasOwnProperty.call(LOCALITY_GUIDES, slug);
