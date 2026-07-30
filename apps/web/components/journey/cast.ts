import { journeyImages, type JourneyImage } from "@/lib/journey-media"

/**
 * The page's photography, decided in one file.                 Owner: W-NIGHT
 *
 * ## Why a cast module instead of `imagesForAct(act)[n]`
 *
 * The acts are buckets from the harvest, not an edit, and they do not describe
 * content:
 *
 *   `cut`      is three TERRA floor plans. Not photography at all.
 *   `grounds`  is one beach, four hotel INTERIORS, and an aquapark render.
 *   `room`     is six apartment interiors, from the developer, not the hotel.
 *   `complex`  and `approach` mix real aerials with marketing visualisations.
 *
 * So `imagesForAct("grounds")[1]` under a heading reading "Die Außenanlagen"
 * puts a wine bar in the outdoor-facilities section, and `imagesForAct("cut")[0]`
 * under "Das Hotel · 188 Zimmer" puts an architectural drawing there. Both of
 * those shipped. An index into a bucket is a guess about content.
 *
 * Every slot below is a named ID with a note saying what the frame shows, so a
 * reader can check the edit without opening twenty-two files, and a regenerated
 * projection that drops an asset produces a missing frame rather than a
 * silently different one.
 *
 * ## What is deliberately not cast
 *
 * The three floor plans. They are the highest-value assets in the harvest and
 * they are also the ones whose source, TERRA, comes closest to forbidding
 * display outright (MEDIA-LICENSE.md §2: private use with attribution, and a
 * public landing page is not private use under any reading). They are not
 * needed for anything here, so they are not shown.
 *
 * Three apartment interiors are unused simply because the page has more good
 * frames than places to put them, which is the right direction.
 */

/** Look an asset up by id, or `null` if it is no longer published. */
function frame(id: string): JourneyImage | null {
  return journeyImages.find((image) => image.id === id) ?? null
}

export const cast = {
  /** Dusk, the complex mirrored in its own pool. The strongest frame here. */
  hero: frame("azw-azuraworldhotel-com-69be5fa4ca5b"),

  /** The living room with the crystal chandelier — the strongest interior in
      the set, so it leads "What Azura World is". The master bedroom it replaced
      moved into the residences gallery below, where it still earns its place. */
  whyPlate: frame("azw-cebecigroup-com-f8f351f7f676"),

  /** The outdoor set, now a browsable gallery: the aquapark, the pool and beach,
      the water axis, the facade, and the aerial of the whole site. Every frame
      is the developer's visualisation and carries the chip that says so, in the
      thumbnail and again in the lightbox — the media-rights line (skill §7) is
      "captioned, sourced", and a lightbox that keeps the caption still is. */
  grounds: [
    frame("azw-housearch-com-9c459f37049c"),
    frame("azw-housearch-com-a5d50353394d"),
    frame("azw-housearch-com-87a086f5e3b1"),
    frame("azw-housearch-com-f2903b62f3aa"),
    frame("azw-housearch-com-989bab955ff8"),
    frame("azw-enspride-com-f5e0ff7153a0"),
  ].filter((image) => image !== null),

  /** The hotel's own spaces, as a gallery: the wine bar, two restaurant frames,
      and the pool terrace. Photographs from the hotel's own site, so no render
      chip; the credit still names azuraworldhotel.com on every frame. */
  hotel: [
    frame("azw-azuraworldhotel-com-507b55eb1bc5"),
    frame("azw-azuraworldhotel-com-fce38d965709"),
    frame("azw-azuraworldhotel-com-19d34904ddb7"),
    frame("azw-azuraworldhotel-com-4d29956b9d38"),
  ].filter((image) => image !== null),

  /** The residence interiors, as a gallery beside the layout figures. The
      living room moved up to lead "What Azura World is", so this is the private
      side of a home: the master bedroom, an art-deco bedroom, a dressing suite
      and a marble bath. Developer photographs, credited. */
  residences: [
    frame("azw-cebecigroup-com-9ee92ba4404e"),
    frame("azw-cebecigroup-com-8cb59c7f90fa"),
    frame("azw-cebecigroup-com-8bd9150c82bb"),
    frame("azw-cebecigroup-com-38f672f2d306"),
  ].filter((image) => image !== null),

  /** A balcony over the sea. The page opens on water and closes on it. */
  close: frame("azw-cebecigroup-com-1d8d94bffade"),

  /**
   * The signed-out pages.
   *
   * `/login` used `imagesForAct("room")[0]`, a tight interior of one bed. Beside
   * a sign-in form it reads as a hotel booking page, not as the way into a
   * system that runs a 76.000 m² site — you cannot tell what the building is.
   * Both frames are now the building itself, and both are photographs rather
   * than visualisations, because this is the first surface a new user sees.
   */
  signIn: frame("azw-azuraworldhotel-com-69be5fa4ca5b"),
  signUp: frame("azw-hasporealty-com-7c4bb03ab1c2"),
} as const
