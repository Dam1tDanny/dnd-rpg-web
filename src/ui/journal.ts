// A scrollable journal/log panel. The App owns one per screen and appends
// the string[] lines the game logic returns. Auto-scrolls to the newest line.
// It can also pin a live-updating hero profile block at the top: the profile
// re-renders from its renderer on every added line, so it never goes stale.

export class Journal {
  private el: HTMLDivElement;
  private profileEl: HTMLDivElement | null = null;
  private profileRenderer: (() => string[]) | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "journal";
  }

  get element(): HTMLDivElement {
    return this.el;
  }

  /** Pin a live hero-profile block at the top of the log. Replaces any existing one. */
  setProfile(renderer: () => string[]): void {
    this.profileEl?.remove();
    this.profileRenderer = renderer;
    this.profileEl = document.createElement("div");
    this.profileEl.className = "journal-profile";
    this.el.prepend(this.profileEl);
    this.renderProfile();
  }

  private renderProfile(): void {
    if (!this.profileEl || !this.profileRenderer) return;
    this.profileEl.innerHTML = "";
    for (const line of this.profileRenderer()) {
      const div = document.createElement("div");
      div.className = "journal-line";
      div.textContent = line;
      this.profileEl.appendChild(div);
    }
  }

  add(line: string): void {
    const div = document.createElement("div");
    div.className = "journal-line";
    div.textContent = line;
    this.el.appendChild(div);
    this.renderProfile();
    this.el.scrollTop = this.el.scrollHeight;
  }

  addMany(lines: string[]): void {
    for (const line of lines) this.add(line);
  }

  clear(): void {
    this.el.innerHTML = "";
    this.profileEl = null;
    this.profileRenderer = null;
  }
}
