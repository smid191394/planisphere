import { Body, Star } from "./sky";
import { Session } from "./log";

/** What is written up after a night, whoever it is written for. */
export class Report {
  constructor(readonly session: Session) {}

  /** One line, as it would be read out. */
  headline(): string {
    return `${this.session.observer} saw ${this.session.bodies().length} bodies`;
  }
}

/** The report the observatory keeps for itself, with the failures in it. */
export class NightlyReport extends Report {
  /** The looks the instrument could not have made in that band. */
  doubtful(): number {
    return this.session.observations.filter((o) => !o.plausible).length;
  }
}

/** The brightest of the bodies, or nothing where there are none. */
export function brightest(bodies: Body[]): Body | undefined {
  return bodies.reduce<Body | undefined>(
    (best, body) => (best && best.brighterThan(body) ? best : body),
    undefined
  );
}

/** The stars a session looked at, brightest first. */
export function starsBySize(catalogue: Star[]): Star[] {
  return [...catalogue].sort((a, b) => a.magnitude - b.magnitude);
}
