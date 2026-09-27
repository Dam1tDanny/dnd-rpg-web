// A scrollable journal/log panel. The App owns one per screen and appends
// the string[] lines the game logic returns. Auto-scrolls to the newest line.

export class Journal {
  private el: HTMLDivElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "journal";
  }

  get element(): HTMLDivElement {
    return this.el;
  }

  add(line: string): void {
    const div = document.createElement("div");
    div.className = "journal-line";
    div.textContent = line;
    this.el.appendChild(div);
    this.el.scrollTop = this.el.scrollHeight;
  }

  addMany(lines: string[]): void {
    for (const line of lines) this.add(line);
  }

  clear(): void {
    this.el.innerHTML = "";
  }
}
