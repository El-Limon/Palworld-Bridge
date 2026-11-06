/** Failed REST probes in a row before the server counts as down (one probe every 5 seconds). */
export const PROBE_FAILURES_FOR_DOWN = 3;

/**
 * Takaro treats "not connectable" as a dead server and marks every player offline, so one slow
 * probe on a busy machine must not count. A real outage shows after a few probes in a row.
 */
export class ServerProbeFilter {
  private failures = 0;
  private up = false;

  note(probeUp: boolean): boolean {
    if (probeUp) {
      this.failures = 0;
      this.up = true;
    } else if (++this.failures >= PROBE_FAILURES_FOR_DOWN) {
      this.up = false;
    }
    return this.up;
  }
}
