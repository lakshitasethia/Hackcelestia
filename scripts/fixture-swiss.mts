/**
 * A Switzerland research result, hand-written.
 *
 * Shaped exactly like what `researchTrip` returns, with values that are
 * plausible rather than invented — real attractions, roughly real prices. It
 * exists so the half of the pipeline after the web pass can be tested and
 * previewed without spending Groq's daily token budget, and without a passing
 * test depending on what a search engine returns today.
 *
 * Shared by `test-compose-abroad.mts` and `make-proposal.mts` so the two never
 * drift into testing and previewing different things.
 */
import type { ResearchResult } from "../src/lib/agent/research.js";
import type { TripSpec } from "../src/lib/agent/intake.js";

export const spec: TripSpec = {
  title: "Switzerland by rail",
  partySize: 2,
  budget: 400000,
  currency: "INR",
  startsOn: "2026-10-02",
  endsOn: "2026-10-14",
  origin: "India",
  destinations: ["Switzerland"],
  mustDo: ["chocolate factory"],
  transport: "trains",
  interests: ["scenic", "rail", "nature"],
  pace: "moderate",
  dietary: [],
  mobility: null,
  style: null,
  unclear: [],
};

/** Shaped exactly like what `researchTrip` returns, with plausible real values. */
export const research: ResearchResult = {
  cities: ["Zurich", "Lucerne", "Interlaken", "Zermatt"],
  country: "Switzerland",
  currency: "CHF",
  timeZone: "Europe/Zurich",
  fxToBudget: 105,
  places: [
    { title: "Lindt Home of Chocolate", type: "activity", description: "Chocolate museum with the world's tallest chocolate fountain.", city: "Zurich", durationMin: 120, cost: 15, opensAt: "10:00", closesAt: "18:00", tags: ["chocolate", "museum", "family"], sourceUrl: "https://www.lindt-home-of-chocolate.com/en/", weatherSensitive: false },
    { title: "Old Town Zurich walk", type: "activity", description: "Guild houses, Grossmunster and the Limmat.", city: "Zurich", durationMin: 150, cost: 0, opensAt: "09:00", closesAt: "20:00", tags: ["history", "scenic"], sourceUrl: "https://www.zuerich.com/en", weatherSensitive: true },
    { title: "Swiss National Museum", type: "activity", description: "Swiss cultural history opposite the main station.", city: "Zurich", durationMin: 120, cost: 13, opensAt: "10:00", closesAt: "17:00", tags: ["museum", "history"], sourceUrl: "https://www.landesmuseum.ch/en", weatherSensitive: false },
    { title: "Zurich Youth Hostel", type: "hotel", description: "Budget double rooms a tram ride from the centre.", city: "Zurich", durationMin: 600, cost: 140, opensAt: null, closesAt: null, tags: ["budget"], sourceUrl: "https://www.youthhostel.ch/en/hostels/zurich/", weatherSensitive: false },
    { title: "Swiss Museum of Transport", type: "activity", description: "Switzerland's most visited museum.", city: "Lucerne", durationMin: 180, cost: 35, opensAt: "10:00", closesAt: "18:00", tags: ["museum", "family", "rail"], sourceUrl: "https://www.verkehrshaus.ch/en", weatherSensitive: false },
    { title: "Chapel Bridge and Old Town", type: "activity", description: "The painted wooden bridge and the medieval centre.", city: "Lucerne", durationMin: 90, cost: 0, opensAt: "08:00", closesAt: "21:00", tags: ["history", "scenic"], sourceUrl: "https://www.luzern.com/en/", weatherSensitive: true },
    { title: "Mount Pilatus golden round trip", type: "activity", description: "Cogwheel railway, cable car and boat.", city: "Lucerne", durationMin: 360, cost: 84, opensAt: "08:00", closesAt: "17:30", tags: ["scenic", "nature", "rail"], sourceUrl: "https://www.pilatus.ch/en/", weatherSensitive: true },
    { title: "Backpackers Lucerne", type: "hotel", description: "Lakeside hostel with budget doubles.", city: "Lucerne", durationMin: 600, cost: 110, opensAt: null, closesAt: null, tags: ["budget"], sourceUrl: "https://www.backpackerslucerne.ch/", weatherSensitive: false },
    { title: "Harder Kulm funicular", type: "activity", description: "Viewpoint over Interlaken and both lakes.", city: "Interlaken", durationMin: 150, cost: 38, opensAt: "09:00", closesAt: "19:00", tags: ["scenic", "viewpoint"], sourceUrl: "https://www.jungfrau.ch/en-gb/harder-kulm/", weatherSensitive: true },
    { title: "Jungfraujoch railway", type: "activity", description: "The Top of Europe by rack railway.", city: "Interlaken", durationMin: 480, cost: 210, opensAt: "07:00", closesAt: "17:00", tags: ["rail", "scenic", "nature"], sourceUrl: "https://www.jungfrau.ch/en-gb/jungfraujoch-top-of-europe/", weatherSensitive: true },
    { title: "Lake Brienz boat", type: "activity", description: "Steamer across the turquoise lake.", city: "Interlaken", durationMin: 120, cost: 32, opensAt: "10:00", closesAt: "18:00", tags: ["scenic", "nature"], sourceUrl: "https://www.bls.ch/en/freizeit/schifffahrt", weatherSensitive: true },
    { title: "Backpackers Villa Interlaken", type: "hotel", description: "Budget rooms opposite the Hohematte.", city: "Interlaken", durationMin: 600, cost: 130, opensAt: null, closesAt: null, tags: ["budget"], sourceUrl: "https://www.villa.ch/en/", weatherSensitive: false },
    { title: "Gornergrat railway", type: "activity", description: "Cog railway to a Matterhorn panorama.", city: "Zermatt", durationMin: 240, cost: 132, opensAt: "07:00", closesAt: "18:00", tags: ["rail", "scenic", "nature"], sourceUrl: "https://www.gornergratbahn.ch/en", weatherSensitive: true },
    { title: "Matterhorn Glacier Paradise", type: "activity", description: "Europe's highest cable car station.", city: "Zermatt", durationMin: 300, cost: 120, opensAt: "08:30", closesAt: "16:00", tags: ["scenic", "nature"], sourceUrl: "https://www.matterhornparadise.ch/en", weatherSensitive: true },
    { title: "Zermatt Youth Hostel", type: "hotel", description: "Budget beds with a Matterhorn view.", city: "Zermatt", durationMin: 600, cost: 160, opensAt: null, closesAt: null, tags: ["budget"], sourceUrl: "https://www.youthhostel.ch/en/hostels/zermatt/", weatherSensitive: false },
  ],
  legs: [
    { title: "Train: Zurich → Lucerne", from: "Zurich", to: "Lucerne", durationMin: 45, cost: 27, departsAt: "09:00", overnight: false, sourceUrl: "https://www.sbb.ch/en" },
    { title: "Train: Lucerne → Interlaken (Golden Pass)", from: "Lucerne", to: "Interlaken", durationMin: 110, cost: 34, departsAt: "10:00", overnight: false, sourceUrl: "https://www.sbb.ch/en" },
    { title: "Train: Interlaken → Zermatt", from: "Interlaken", to: "Zermatt", durationMin: 135, cost: 68, departsAt: "09:30", overnight: false, sourceUrl: "https://www.sbb.ch/en" },
    { title: "Train: Zermatt → Zurich", from: "Zermatt", to: "Zurich", durationMin: 200, cost: 88, departsAt: "08:00", overnight: false, sourceUrl: "https://www.sbb.ch/en" },
  ],
  sources: [
    { title: "SBB timetable", url: "https://www.sbb.ch/en" },
    { title: "Lindt Home of Chocolate", url: "https://www.lindt-home-of-chocolate.com/en/" },
  ],
  notes: ["Some high-altitude railways run a reduced October timetable."],
};

