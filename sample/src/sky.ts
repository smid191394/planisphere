// A small observatory's log, kept as a sample: what Planisphere draws when a
// reader has nothing of their own to draw yet.

/** Where a body sits on the sky, as a catalogue records it. */
export interface Coordinates {
  rightAscension: number;
  declination: number;
}

/** Anything a catalogue gives a designation to. */
export interface Catalogued {
  designation: string;
  at: Coordinates;
}

/** The part of the spectrum an observation was made in. */
export enum Band {
  Visual = "visual",
  Infrared = "infrared",
  Radio = "radio",
}

/** Something in the sky, bright enough that this observatory has looked at it. */
export class Body implements Catalogued {
  constructor(
    readonly designation: string,
    readonly at: Coordinates,
    readonly magnitude: number
  ) {}

  /** How bright it looks from here, where a smaller number is brighter. */
  brighterThan(other: Body): boolean {
    return this.magnitude < other.magnitude;
  }
}

/** A body that shines by itself. */
export class Star extends Body {
  constructor(
    designation: string,
    at: Coordinates,
    magnitude: number,
    readonly spectralType: string
  ) {
    super(designation, at, magnitude);
  }
}

/** A body that shines by the light of the star it goes around. */
export class Planet extends Body {
  constructor(
    designation: string,
    at: Coordinates,
    magnitude: number,
    readonly orbits: Star
  ) {
    super(designation, at, magnitude);
  }
}

/** A body that is only worth looking at for a few weeks at a time. */
export class Comet extends Body {
  /** When it is next as near as it gets. */
  perihelion?: Date;
}
