import { Band, Body, Star } from "./sky";
import { Instrument } from "./instruments";

/** One look at one body, through one instrument. */
export class Observation {
  constructor(
    readonly body: Body,
    readonly instrument: Instrument,
    readonly band: Band,
    readonly taken: Date
  ) {}

  /** Whether the instrument could have made this reading at all. */
  get plausible(): boolean {
    return this.instrument.bands.includes(this.band);
  }
}

/** Everything one observer did in one night. */
export class Session {
  readonly observations: Observation[] = [];

  constructor(readonly observer: string, readonly night: Date) {}

  /** Add a look to the night, and hand it back for chaining. */
  record(observation: Observation): Observation {
    this.observations.push(observation);
    return observation;
  }

  /** The bodies this night saw, each of them once. */
  bodies(): Body[] {
    const seen = new Map<string, Body>();
    for (const o of this.observations) seen.set(o.body.designation, o.body);
    return [...seen.values()];
  }
}

/** The names an observatory keeps for what it has looked at. */
export class Catalogue {
  private readonly bodies = new Map<string, Body>();

  /** Put a body in the catalogue, under its designation. */
  add(body: Body): void {
    this.bodies.set(body.designation, body);
  }

  /** The body that designation names, or nothing. */
  find(designation: string): Body | undefined {
    return this.bodies.get(designation);
  }

  /** Every star in it, in the order they were added. */
  stars(): Star[] {
    return [...this.bodies.values()].filter((b): b is Star => b instanceof Star);
  }
}
