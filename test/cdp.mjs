/**
 * A minimal Chrome DevTools Protocol driver.
 *
 * Node 22 ships both fetch and WebSocket, so driving a real browser needs no
 * dependencies at all: find the page target over HTTP, then speak CDP over a
 * socket. Enough for real mouse and key events, which is the whole point —
 * a screenshot cannot click.
 */

export class Browser {
  #socket = null;
  #nextId = 1;
  #pending = new Map();
  #events = new Map();

  /**
   * Attaches to the app's own tab.
   *
   * Taking the first page target attached to whatever Chrome happened to list
   * first, which after an earlier run can be a stray blank tab: the suite then
   * failed before its first check, reporting "1 of 0 failed". Prefer a target
   * serving the app, and only fall back to any page.
   */
  static async attach(port = 9222, tries = 60, wants = '127.0.0.1:8124') {
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await response.json();
        const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
        const page = pages.find((target) => String(target.url || '').includes(wants)) || pages[0];
        if (page) {
          const browser = new Browser();
          await browser.#connect(page.webSocketDebuggerUrl);
          return browser;
        }
      } catch { /* Chrome is still starting */ }
      await new Promise((resolve) => { setTimeout(resolve, 250); });
    }
    throw new Error('Could not attach to Chrome on port ' + port);
  }

  #connect(url) {
    return new Promise((resolve, reject) => {
      this.#socket = new WebSocket(url);
      this.#socket.addEventListener('open', () => resolve());
      this.#socket.addEventListener('error', reject);
      this.#socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id && this.#pending.has(message.id)) {
          const { resolve: done, reject: fail } = this.#pending.get(message.id);
          this.#pending.delete(message.id);
          if (message.error) fail(new Error(message.error.message));
          else done(message.result);
          return;
        }
        if (message.method) {
          const waiting = this.#events.get(message.method);
          if (waiting) { this.#events.delete(message.method); waiting(message.params); }
        }
      });
    });
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise((resolve) => this.#events.set(method, resolve));
  }

  /**
   * Closes the socket and waits for it.
   *
   * The suites called this and then process.exit() on the next line, so the
   * close never flushed and Chrome could still hold the old client when the
   * next suite attached.
   */
  close() {
    const socket = this.#socket;
    if (!socket || socket.readyState === 3) return Promise.resolve();
    return new Promise((resolve) => {
      socket.addEventListener('close', () => resolve(), { once: true });
      socket.close();
      setTimeout(resolve, 500);
    });
  }

  /* ------------------------- page helpers ------------------------- */

  async open(url) {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    // The app boots from ES modules, and Chrome will happily reuse a cached
    // one across a navigation. A source change already saved to disk was
    // therefore invisible to the test, which silently checked the old code.
    await this.send('Network.enable').catch(() => {});
    await this.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
    const loaded = this.once('Page.loadEventFired');
    await this.send('Page.navigate', { url });
    await loaded;
    // The app boots from an ES module, so wait for it to have drawn.
    await this.waitFor('document.querySelector("#canvas-host svg") !== null');
  }

  /** Evaluates an expression in the page and returns its value. */
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(() => { ${expression.includes('return') ? expression : `return (${expression})`} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'evaluation failed');
    }
    return result.result.value;
  }

  async waitFor(expression, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.eval(expression)) return true;
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  /** One animation frame, so a scheduled redraw has happened. */
  async settle(frames = 3) {
    for (let index = 0; index < frames; index++) {
      await this.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))).then(() => true)');
    }
  }

  /* --------------------------- input ------------------------------ */

  async mouse(type, x, y, options = {}) {
    await this.send('Input.dispatchMouseEvent', {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: options.button ?? 'left',
      buttons: type === 'mouseReleased' ? 0 : (options.buttons ?? 1),
      clickCount: options.clickCount ?? 1,
      modifiers: options.modifiers ?? 0,
    });
  }

  /** Press, move in steps, release. Steps matter: one jump is not a drag. */
  async drag(from, to, options = {}) {
    await this.mouse('mousePressed', from.x, from.y, options);
    const steps = options.steps ?? 6;
    for (let index = 1; index <= steps; index++) {
      await this.mouse('mouseMoved',
        from.x + ((to.x - from.x) * index) / steps,
        from.y + ((to.y - from.y) * index) / steps,
        options);
    }
    await this.mouse('mouseReleased', to.x, to.y, options);
  }

  async click(x, y, options = {}) {
    await this.mouse('mousePressed', x, y, options);
    await this.mouse('mouseReleased', x, y, options);
  }

  async key(key, options = {}) {
    const common = {
      key,
      code: options.code ?? key,
      modifiers: options.modifiers ?? 0,
      windowsVirtualKeyCode: options.keyCode ?? 0,
      nativeVirtualKeyCode: options.keyCode ?? 0,
    };
    await this.send('Input.dispatchKeyEvent', { ...common, type: 'keyDown' });
    await this.send('Input.dispatchKeyEvent', { ...common, type: 'keyUp' });
  }

  /** The centre of an element, in viewport coordinates. */
  async centreOf(selector) {
    return this.eval(`
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2,
               left: box.left, top: box.top, width: box.width, height: box.height };
    `);
  }

  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, Buffer.from(data, 'base64'));
  }
}

export const MOD = { none: 0, alt: 1, ctrl: 2, meta: 4, shift: 8 };
