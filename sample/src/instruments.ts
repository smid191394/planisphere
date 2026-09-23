import { Band, Body } from "./sky";

/** Something that can be pointed at a body and asked for a reading. */
export interface Instrument {
  name: string;
  bands: Band[];
  point(at: Body): void;
}

/** The instrument everything else here is bolted to. */
export class Telescope implements Instrument {
  readonly bands = [Band.Visual, Band.Infrared];
  private aimedAt?: Body;

  constructor(readonly name: string, readonly apertureMm: number) {}

  point(at: Body): void {
    this.aimedAt = at;
  }

  /** What it is looking at, if anything. */
  get target(): Body | undefined {
    return this.aimedAt;
  }
}

/** What the telescope's light falls on. */
export class Camera implements Instrument {
  readonly bands = [Band.Visual];

  constructor(readonly name: string, readonly through: Telescope) {}

  point(at: Body): void {
    this.through.point(at);
  }

  /** How long the shutter is open for, in seconds. */
  exposure = 30;
}

/** An instrument that listens rather than looks. */
export class Dish implements Instrument {
  readonly bands = [Band.Radio];

  constructor(readonly name: string, readonly diameterM: number) {}

  point(_at: Body): void {
    // A dish is slow to turn, which the log does not record.
  }
}
