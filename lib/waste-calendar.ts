export type WasteKind = "rest" | "bio" | "yellow" | "paper"

export type WastePickup = {
  id: string
  kind: WasteKind
  title: string
  shortTitle: string
  date: string
}

export const WASTE_CALENDAR_SOURCE = {
  area: "67661 Kaiserslautern-Mölschbach, Hammelstrift",
  provider: "Stadtbildpflege Kaiserslautern",
  validYear: 2026,
  publishedAt: "19.01.2026",
} as const

export const WASTE_DATES = {
  rest: [
    "2026-01-05", "2026-01-19", "2026-02-02", "2026-02-16", "2026-03-02", "2026-03-16", "2026-03-28",
    "2026-04-13", "2026-04-27", "2026-05-11", "2026-05-26", "2026-06-08", "2026-06-22", "2026-07-06",
    "2026-07-20", "2026-08-03", "2026-08-17", "2026-08-31", "2026-09-14", "2026-09-28", "2026-10-12",
    "2026-10-26", "2026-11-09", "2026-11-23", "2026-12-07", "2026-12-19",
  ],
  bio: [
    "2026-01-07", "2026-02-04", "2026-02-18", "2026-03-04", "2026-03-18", "2026-03-31", "2026-04-15",
    "2026-04-29", "2026-05-13", "2026-05-28", "2026-06-03", "2026-06-10", "2026-06-17", "2026-06-24",
    "2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29", "2026-08-05", "2026-08-12",
    "2026-08-19", "2026-08-26", "2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30",
    "2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28", "2026-11-11", "2026-11-25", "2026-12-09",
    "2026-12-22",
  ],
  yellow: [
    "2026-01-14", "2026-01-28", "2026-02-11", "2026-02-25", "2026-03-11", "2026-03-25", "2026-04-09",
    "2026-04-22", "2026-05-06", "2026-05-20", "2026-06-03", "2026-06-17", "2026-07-01", "2026-07-15",
    "2026-07-29", "2026-08-12", "2026-08-26", "2026-09-09", "2026-09-23", "2026-10-07", "2026-10-21",
    "2026-11-04", "2026-11-18", "2026-12-02", "2026-12-16", "2026-12-30",
  ],
  paper: [
    "2026-01-23", "2026-02-20", "2026-03-20", "2026-04-17", "2026-05-16", "2026-06-12", "2026-07-10",
    "2026-08-07", "2026-09-04", "2026-10-02", "2026-10-30", "2026-11-27", "2026-12-24",
  ],
} as const satisfies Record<WasteKind, readonly string[]>

const WASTE_DETAILS: Record<WasteKind, Pick<WastePickup, "title" | "shortTitle">> = {
  rest: { title: "Restabfall", shortTitle: "Rest" },
  bio: { title: "Bioabfall", shortTitle: "Bio" },
  yellow: { title: "Gelbe Tonne", shortTitle: "Gelb" },
  paper: { title: "Altpapier", shortTitle: "Papier" },
}

export const WASTE_PICKUPS: WastePickup[] = (Object.keys(WASTE_DATES) as WasteKind[])
  .flatMap((kind) => WASTE_DATES[kind].map((date) => ({
    id: `waste-${kind}-${date}`,
    kind,
    date,
    ...WASTE_DETAILS[kind],
  })))
  .sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title))

const WASTE_BY_DATE = new Map<string, WastePickup[]>()
for (const pickup of WASTE_PICKUPS) {
  WASTE_BY_DATE.set(pickup.date, [...(WASTE_BY_DATE.get(pickup.date) ?? []), pickup])
}

export function wastePickupsForDate(date: string) {
  return WASTE_BY_DATE.get(date) ?? []
}
