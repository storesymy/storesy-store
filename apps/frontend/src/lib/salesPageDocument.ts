import uiCss from "@storesy/ui/styles.css?inline";
import { COUNTRIES, ORDER_SHIPPING_CENTS } from "@storesy/shared";
import type { Product } from "@storesy/shared";
import { googleFontHref } from "./googleFonts";
import { formatPrice, imageSrc } from "./product";
import { renderSectionsHtml } from "./salesHtml";
import { canvasStyleVars, htmlTypeOf, htmlFor, isFullDocumentHtml } from "./salesPages";
import type { SalesPage } from "./salesPages";
import appCss from "../styles.css?inline";

/**
 * The standalone document served at `/<slug>` — plain HTML a crawler reads
 * without running a byte of JavaScript. Built by the SPA on every save (the
 * SPA owns the renderers and the styles) and stored in R2 as the page's
 * `page.html`; the Worker just streams it.
 *
 * Composition: SEO/OG `<head>` + Google Fonts + the app's section styles
 * inlined + the live document's markup. A complete document (an imported or
 * hand-written page) is already its own `<head>` and ships untouched; a
 * fragment or the component canvas renders inside the themed wrapper.
 *
 * The checkout block is the one interactive resident: its product cards,
 * prices and form are real markup (crawlable, readable with scripts off),
 * and one small inline script adds the cart behaviour on top — quantities,
 * totals and the submit to `/api/public/orders`, which revalidates every
 * price server-side.
 */

/** HTML-escape for text nodes and attribute values. */
function esc(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

/** `canvasStyleVars` record → a safe `style="…"` attribute value. */
function styleAttribute(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => {
      // Custom properties are already kebab; React-style names need kebabing.
      const cssKey = key.startsWith("--") ? key : key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      return `${cssKey}:${value}`;
    })
    .join(";");
}

/** Absolute address for OG assets — scrapers reject relative image URLs. */
function absoluteUrl(value: string, base?: string): string {
  if (!value) return "";
  try {
    return new URL(value, base).href;
  } catch {
    return "";
  }
}

function meta(name: string, content: string, property = false): string {
  const key = property ? "property" : "name";
  return `<meta ${key}="${esc(name)}" content="${esc(content)}">`;
}

/* --------------------------- Checkout block --------------------------- */

/**
 * The checkout block ships when the page toggles it on ("Show Checkout") and
 * at least one picked product resolves to an active listing. The markup is
 * the real thing — product cards with prices, the cart shell, the customer
 * form — so the products are crawlable and the whole section reads with
 * scripts off; `CHECKOUT_SCRIPT` then adds the cart behaviour on top. A
 * complete document gets the same block as a rider appended before its
 * `</body>` — its own markup and styles are never touched.
 */
function checkoutEnabled(page: SalesPage, products: Product[]): boolean {
  return page.style.checkout === "show" && products.some((product) => product.status === "active");
}

/** Price the buyer pays — the sale price when a discount is running. */
function effectivePrice(product: Product): number {
  return product.discountPrice ?? product.price;
}

/** The static checkout section: cards, cart shell, customer form. */
function checkoutMarkup(page: SalesPage, products: Product[]): string {
  const listed = products.filter((product) => product.status === "active");
  if (!checkoutEnabled(page, products)) return "";

  const cards = listed
    .map((product) => {
      const image = product.featured
        ? `<img src="${esc(imageSrc(product.featured))}" alt="${esc(product.name)}" loading="lazy">`
        : "";
      const was =
        product.discountPrice !== null
          ? `<s class="sco__priceWas">${esc(formatPrice(product.price))}</s>`
          : "";
      return (
        `<article class="sco__card" data-item="${esc(product.id)}"` +
        ` data-price="${effectivePrice(product)}"` +
        ` data-ships="${product.fulfilment.shipment ? "1" : "0"}">` +
        `<span class="sco__thumb">${image}</span>` +
        `<div class="sco__cardBody">` +
        `<span class="sco__name">${esc(product.name)}</span>` +
        `<span class="sco__price">` +
        `<span class="sco__priceNow">${esc(formatPrice(effectivePrice(product)))}</span>` +
        was +
        `</span></div>` +
        `<button type="button" class="sco__add" data-add="${esc(product.id)}">Add product</button>` +
        `</article>`
      );
    })
    .join("");

  const field = (name: string, label: string, type: string, placeholder: string, wide = false, address = false) =>
    `<label class="sco__field${wide ? " sco__field--wide" : ""}"${address ? " data-addr" : ""}${address ? " hidden" : ""}>` +
    `<span>${esc(label)}</span>` +
    `<input type="${type}" name="${esc(name)}" placeholder="${esc(placeholder)}" autocomplete="on">` +
    `</label>`;

  return (
    `<section class="sco" data-sco data-slug="${esc(page.slug)}"` +
    ` data-shipping="${ORDER_SHIPPING_CENTS}">` +
    `<div class="ssv__wrap">` +
    `<h3 class="ssv__title sco__title">Checkout</h3>` +
    // Product listing — the products picked for this page, priced in markup.
    `<div class="sco__grid">${cards}</div>` +
    // Cart: the empty note shows until the script adds a line.
    `<h4 class="sco__h4">Cart</h4>` +
    `<p class="sco__note" data-cart-empty>Your cart is empty — add a product above.</p>` +
    `<div class="sco__cart" data-cart hidden>` +
    `<div data-lines></div>` +
    `<div class="sco__ship" data-ship hidden>` +
    `<span>Shipping</span><span class="sco__shipNum" data-ship-num></span></div>` +
    `<div class="sco__total"><span>Total</span>` +
    `<span class="sco__totalNum" data-total></span></div>` +
    `</div>` +
    // Customer details — the address block appears when something ships.
    `<h4 class="sco__h4">Customer details</h4>` +
    `<form data-form novalidate>` +
    `<div class="sco__fields">` +
    field("name", "Name", "text", "Jane Doe") +
    field("phone", "Phone", "tel", "012 345 6789") +
    field("email", "Email", "email", "jane@example.com", true) +
    field("address", "Address", "text", "Street address", true, true) +
    field("postcode", "Postcode", "text", "50000", false, true) +
    field("city", "City", "text", "Kuala Lumpur", false, true) +
    field("state", "State", "text", "Selangor", true, true) +
    `<label class="sco__field sco__field--wide" data-addr hidden>` +
    `<span>Country</span>` +
    `<select name="country">` +
    `<option value="">Choose a country…</option>` +
    COUNTRIES.map((country) => `<option value="${country.code}">${esc(country.name)}</option>`).join("") +
    `</select></label>` +
    `</div>` +
    `<p class="sco__err" data-err hidden></p>` +
    `<button type="submit" class="sco__pay" data-submit>Proceed to Payment</button>` +
    `</form>` +
    // Admin-only test controls. Hidden for buyers; the script reveals them
    // when /api/me answers with an owner/admin session, and the endpoint
    // behind them is admin-gated regardless.
    `<div class="sco__test" data-test-row hidden>` +
    `<button type="button" class="sco__testBtn" data-test="success">Test: Success</button>` +
    `<button type="button" class="sco__testBtn" data-test="failed">Test: Failed</button>` +
    `<button type="button" class="sco__testBtn" data-test="cancel">Test: Cancel</button>` +
    `</div>` +
    `</div></section>`
  );
}

/**
 * The one script the document carries: cart state for the checkout block
 * above. Reads the baked `data-` attributes as its product catalogue, keeps
 * the cart in `localStorage` per page, renders lines with `textContent`
 * only, and submits to the same-origin `/api/public/orders` — which ignores
 * these prices and recomputes them server-side. A 409 means the merchant's
 * prices moved since this document was built, so the page reloads to ask
 * the Worker for the current one.
 *
 * Deliberately dependency-free and written without template literals: the
 * string is embedded straight into a `<script>` tag in the stored document.
 */
const CHECKOUT_SCRIPT = [
  '(function () {',
  '  var root = document.querySelector("[data-sco]");',
  '  if (!root) return;',
  '  var slug = root.getAttribute("data-slug");',
  '  var shippingCents = parseInt(root.getAttribute("data-shipping"), 10) || 0;',
  '  var key = "storesy.checkout." + slug;',
  // The order timeline's first two beats, kept for this tab's session only.
  '  function eventStamp(eventKey, value) {',
  '    try { if (!sessionStorage.getItem(eventKey)) sessionStorage.setItem(eventKey, value); } catch (e) {}',
  '  }',
  '  function eventValue(eventKey) {',
  '    try { return sessionStorage.getItem(eventKey) || undefined; } catch (e) { return undefined; }',
  '  }',
  '  eventStamp("storesy.visit." + slug, new Date().toISOString());',
  '  var cards = root.querySelectorAll("[data-item]");',
  '  var catalog = {};',
  '  for (var i = 0; i < cards.length; i++) {',
  '    catalog[cards[i].getAttribute("data-item")] = {',
  '      name: cards[i].querySelector(".sco__name").textContent,',
  '      price: parseInt(cards[i].getAttribute("data-price"), 10),',
  '      ships: cards[i].getAttribute("data-ships") === "1"',
  '    };',
  '  }',
  '  var cart = {};',
  '  try { cart = JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (e) { cart = {}; }',
  '  var linesEl = root.querySelector("[data-lines]");',
  '  var cartEl = root.querySelector("[data-cart]");',
  '  var emptyEl = root.querySelector("[data-cart-empty]");',
  '  var shipEl = root.querySelector("[data-ship]");',
  '  var shipNumEl = root.querySelector("[data-ship-num]");',
  '  var totalEl = root.querySelector("[data-total]");',
  '  var formEl = root.querySelector("[data-form]");',
  '  var errEl = root.querySelector("[data-err]");',
  '  var submitBtn = root.querySelector("[data-submit]");',
  '  var payLabel = submitBtn.textContent;',
  // The buyer's own details survive a refresh and are shared across the
  // store's pages: saved as they type, filled back on the next visit.
  '  var profileKey = "storesy.customer";',
  '  var profileFields = ["name", "phone", "email", "address", "postcode", "city", "state", "country"];',
  '  function saveProfile() {',
  '    var data = {};',
  '    for (var i = 0; i < profileFields.length; i++) {',
  '      var el = formEl.elements[profileFields[i]];',
  '      if (el && el.value) data[profileFields[i]] = el.value;',
  '    }',
  '    try { localStorage.setItem(profileKey, JSON.stringify(data)); } catch (e) {}',
  '  }',
  '  try {',
  '    var storedProfile = JSON.parse(localStorage.getItem(profileKey) || "{}") || {};',
  '    for (var pf = 0; pf < profileFields.length; pf++) {',
  '      var storedEl = formEl.elements[profileFields[pf]];',
  '      if (storedEl && !storedEl.value && storedProfile[profileFields[pf]]) {',
  '        storedEl.value = storedProfile[profileFields[pf]];',
  '      }',
  '    }',
  '  } catch (e) {}',
  '  var profileTimer = null;',
  '  formEl.addEventListener("input", function () {',
  '    if (profileTimer) clearTimeout(profileTimer);',
  '    profileTimer = setTimeout(saveProfile, 200);',
  '  });',
  '  formEl.addEventListener("change", saveProfile);',
  '  function setBusy(label) {',
  '    submitBtn.disabled = true;',
  '    submitBtn.classList.add("sco__pay--busy");',
  '    submitBtn.setAttribute("aria-busy", "true");',
  '    submitBtn.textContent = label;',
  '  }',
  '  function setIdle() {',
  '    submitBtn.disabled = false;',
  '    submitBtn.classList.remove("sco__pay--busy");',
  '    submitBtn.removeAttribute("aria-busy");',
  '    submitBtn.textContent = payLabel;',
  '  }',
  '  function money(cents) { return "RM" + (cents / 100).toFixed(2); }',
  '  function save() { try { localStorage.setItem(key, JSON.stringify(cart)); } catch (e) {} }',
  '  function ids() { return Object.keys(cart).filter(function (id) { return catalog[id] && cart[id] > 0; }); }',
  '  function totals() {',
  '    var list = ids(), subtotal = 0, ships = false;',
  '    for (var i = 0; i < list.length; i++) {',
  '      subtotal += catalog[list[i]].price * cart[list[i]];',
  '      if (catalog[list[i]].ships) ships = true;',
  '    }',
  '    var shipping = ships ? shippingCents : 0;',
  '    return { list: list, subtotal: subtotal, shipping: shipping, total: subtotal + shipping, ships: ships };',
  '  }',
  '  function render() {',
  '    var t = totals();',
  '    while (linesEl.firstChild) linesEl.removeChild(linesEl.firstChild);',
  '    for (var i = 0; i < t.list.length; i++) {',
  '      (function (id) {',
  '        var item = catalog[id], qty = cart[id];',
  '        var row = document.createElement("div");',
  '        row.className = "sco__row";',
  '        var name = document.createElement("span");',
  '        name.className = "sco__rowName";',
  '        name.textContent = item.name;',
  '        var unit = document.createElement("span");',
  '        unit.className = "sco__rowUnit";',
  '        unit.textContent = money(item.price);',
  '        var qtyEl = document.createElement("span");',
  '        qtyEl.className = "sco__qty";',
  '        var minus = document.createElement("button");',
  '        minus.type = "button"; minus.className = "sco__step"; minus.textContent = "\\u2212";',
  '        minus.setAttribute("aria-label", "Decrease quantity of " + item.name);',
  '        minus.disabled = qty <= 1;',
  '        minus.addEventListener("click", function () {',
  '          if (cart[id] > 1) { cart[id]--; save(); render(); }',
  '        });',
  '        var num = document.createElement("span");',
  '        num.className = "sco__qtyNum"; num.textContent = String(qty);',
  '        var plus = document.createElement("button");',
  '        plus.type = "button"; plus.className = "sco__step"; plus.textContent = "+";',
  '        plus.setAttribute("aria-label", "Increase quantity of " + item.name);',
  '        plus.addEventListener("click", function () {',
  '          if (cart[id] < 20) { cart[id]++; save(); render(); }',
  '        });',
  '        qtyEl.appendChild(minus); qtyEl.appendChild(num); qtyEl.appendChild(plus);',
  '        var line = document.createElement("span");',
  '        line.className = "sco__rowLine";',
  '        line.textContent = money(item.price * qty);',
  '        var remove = document.createElement("button");',
  '        remove.type = "button"; remove.className = "sco__remove"; remove.textContent = "\\u2715";',
  '        remove.setAttribute("aria-label", "Remove " + item.name + " from cart");',
  '        remove.addEventListener("click", function () {',
  '          delete cart[id]; save(); render();',
  '        });',
  '        row.appendChild(name); row.appendChild(unit); row.appendChild(qtyEl);',
  '        row.appendChild(line); row.appendChild(remove);',
  '        linesEl.appendChild(row);',
  '      })(t.list[i]);',
  '    }',
  '    var has = t.list.length > 0;',
  '    cartEl.hidden = !has;',
  '    emptyEl.hidden = has;',
  '    shipEl.hidden = !t.ships;',
  '    shipNumEl.textContent = money(t.shipping);',
  '    totalEl.textContent = money(t.total);',
  '    var addr = root.querySelectorAll("[data-addr]");',
  '    for (var j = 0; j < addr.length; j++) addr[j].hidden = !t.ships;',
  '  }',
  '  function fail(message) { errEl.textContent = message; errEl.hidden = false; }',
  '  function customerFromForm() {',
  '    function value(name) { return (formEl.elements[name].value || "").trim(); }',
  '    var customer = { name: value("name"), phone: value("phone"), email: value("email") };',
  '    if (customer.name.length < 2) { fail("Give the name for the order."); return null; }',
  '    if (customer.phone.length < 5) { fail("Give a phone number we can reach you on."); return null; }',
  '    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(customer.email)) { fail("Enter a valid email address."); return null; }',
  '    if (totals().ships) {',
  '      customer.address = value("address");',
  '      customer.postcode = value("postcode");',
  '      customer.city = value("city");',
  '      customer.state = value("state");',
  '      if (!customer.address || !customer.postcode || !customer.city || !customer.state) {',
  '        fail("We need a full delivery address for items that ship.");',
  '        return null;',
  '      }',
  '      customer.country = value("country");',
  '      if (!customer.country) {',
  '        fail("Choose the destination country.");',
  '        return null;',
  '      }',
  '    }',
  '    return customer;',
  '  }',
  '  function readJson(response) {',
  '    return response.json().catch(function () { return {}; }).then(function (body) {',
  '      return { status: response.status, body: body };',
  '    });',
  '  }',
  '  function go(url, label) {',
  '    setBusy(label);',
  '    window.location.href = url;',
  '  }',
  '  function startPayment(orderId) {',
  '    setBusy("Starting payment\\u2026");',
  '    return fetch("/api/public/orders/" + encodeURIComponent(orderId) + "/pay", {',
  '      method: "POST"',
  '    }).then(readJson).then(function (pay) {',
  '      if (pay.status === 200 && pay.body.url) { go(pay.body.url, "Redirecting to payment\\u2026"); return; }',
  '      setIdle();',
  '      fail((pay.body && pay.body.error && pay.body.error.message) ||',
  '        "We couldn\'t start the payment — please try again.");',
  '    });',
  '  }',
  '  function simulate(orderId, mode) {',
  '    setBusy(mode === "success" ? "Simulating success\\u2026" :',
  '      mode === "failed" ? "Simulating failure\\u2026" : "Simulating cancel\\u2026");',
  '    return fetch("/api/orders/" + encodeURIComponent(orderId) + "/test", {',
  '      method: "POST",',
  '      headers: { "Content-Type": "application/json" },',
  '      body: JSON.stringify({ outcome: mode })',
  '    }).then(readJson).then(function (result) {',
  '      if (result.status === 200 && result.body.url) { go(result.body.url, "Redirecting\\u2026"); return; }',
  '      setIdle();',
  '      fail((result.body && result.body.error && result.body.error.message) ||',
  '        "Couldn\'t simulate this checkout.");',
  '    });',
  '  }',
  '  function placeOrder(mode) {',
  '    var t = totals();',
  '    if (!t.list.length) { fail("Your cart is empty — add a product first."); return; }',
  '    var customer = customerFromForm();',
  '    if (!customer) return;',
  '    var items = t.list.map(function (id) { return { product: id, qty: cart[id] }; });',
  '    setBusy(mode === "pay" ? "Creating order\\u2026" : "Creating test order\\u2026");',
  '    errEl.hidden = true;',
  '    fetch("/api/public/orders", {',
  '      method: "POST",',
  '      headers: { "Content-Type": "application/json" },',
  '      body: JSON.stringify({',
  '        slug: slug,',
  '        items: items,',
  '        customer: customer,',
  '        totalCents: t.total,',
  '        events: {',
  '          visitedAt: eventValue("storesy.visit." + slug),',
  '          addedAt: eventValue("storesy.cartAt." + slug)',
  '        }',
  '      })',
  '    }).then(readJson).then(function (result) {',
  '      if (result.status === 201 && result.body.order) {',
  '        if (mode === "pay") return startPayment(result.body.order.id);',
  '        return simulate(result.body.order.id, mode);',
  '      }',
  '      setIdle();',
  '      if (result.status === 409) {',
  '        // Prices moved since this document was built — fetch the current one.',
  '        window.location.reload();',
  '        return;',
  '      }',
  '      fail((result.body && result.body.error && result.body.error.message) ||',
  '        "We couldn\'t place the order — please try again.");',
  '    }).catch(function () {',
  '      setIdle();',
  '      fail("We couldn\'t reach the store — check your connection and try again.");',
  '    });',
  '  }',
  '  root.addEventListener("click", function (event) {',
  '    var test = event.target.closest("[data-test]");',
  '    if (test) { placeOrder(test.getAttribute("data-test")); return; }',
  '    var btn = event.target.closest("[data-add]");',
  '    if (!btn) return;',
  '    var id = btn.getAttribute("data-add");',
  '    if (!catalog[id]) return;',
  '    cart[id] = Math.min(20, (cart[id] || 0) + 1);',
  '    eventStamp("storesy.cartAt." + slug, new Date().toISOString());',
  '    errEl.hidden = true;',
  '    save(); render();',
  '  });',
  '  formEl.addEventListener("submit", function (event) {',
  '    event.preventDefault();',
  '    placeOrder("pay");',
  '  });',
  // The test controls appear only for an owner/admin session. The buttons are
  // inert for buyers anyway — the endpoint behind them is admin-gated.
  '  var testRow = root.querySelector("[data-test-row]");',
  '  if (testRow) {',
  '    fetch("/api/me", { headers: { Accept: "application/json" } })',
  '      .then(function (response) { return response.ok ? response.json() : null; })',
  '      .then(function (body) {',
  '        var role = body && body.user && body.user.role;',
  '        if (role === "owner" || role === "admin") testRow.hidden = false;',
  '      })',
  '      .catch(function () {});',
  '  }',
  // Back from the gateway: the server attached the reason. Say it plainly,
  // then drop the query so a reload doesn't repeat it.
  '  try {',
  '    var params = new URLSearchParams(window.location.search);',
  '    var outcome = params.get("payment");',
  '    if (outcome === "failed" || outcome === "pending" || outcome === "cancelled") {',
  '      fail(outcome === "cancelled"',
  '        ? "Payment cancelled — your order is still unpaid. You can try again."',
  '        : outcome === "failed"',
  '        ? "Payment didn\'t complete — your order is still unpaid. You can try again."',
  '        : "We haven\'t confirmed your payment yet — if you were charged, please contact the store.");',
  '      errEl.scrollIntoView({ behavior: "smooth", block: "center" });',
  '      window.history.replaceState({}, "", window.location.pathname);',
  '    }',
  '  } catch (e) {}',
  // A visit with nothing chosen starts from the first product in the list,
  // quantity 1 — the block sells on arrival instead of showing an empty cart.
  '  if (ids().length === 0 && cards.length > 0) {',
  '    cart[cards[0].getAttribute("data-item")] = 1;',
  '    eventStamp("storesy.cartAt." + slug, new Date().toISOString());',
  '    save();',
  '  }',
  '  render();',
  '})();',
].join("\n");

/* ------------------------ Checkout rider ------------------------ */

/**
 * The checkout block's own rules, lifted out of the app stylesheet for the
 * rider. A complete document inlines no app CSS (its own stylesheet is the
 * only one it ships), so the rider carries just the block's class-scoped
 * rules — `.sco…`, plus the wrap/title helpers the markup uses. Class
 * selectors cannot match the page's own elements, so the imported design is
 * untouched. `@container` wrappers become `@media`: the rider has no query
 * container ancestor, but the viewport is a faithful stand-in for a block
 * pinned at the bottom of the page.
 */
function checkoutRiderCss(css: string): string {
  const wanted = (header: string): boolean =>
    header.includes(".sco") || header.includes(".ssv__wrap") || header.includes(".ssv__title");

  /** One top-level block: header (selector or at-rule), raw body, end offset. */
  function nextBlock(from: number): { header: string; body: string; end: number } | null {
    let i = from;
    while (i < length) {
      const ch = css[i];
      if (ch === "/" && css[i + 1] === "*") {
        const close = css.indexOf("*/", i + 2);
        i = close === -1 ? length : close + 2;
        continue;
      }
      if (ch === "{") break;
      i += 1;
    }
    if (i >= length) return null;
    const header = css.slice(from, i).trim();
    // Brace matching; this stylesheet has no braces inside declaration strings.
    let depth = 1;
    let j = i + 1;
    while (j < length && depth > 0) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") depth -= 1;
      j += 1;
    }
    return { header, body: css.slice(i + 1, j - 1), end: j };
  }

  const length = css.length;
  const kept: string[] = [];
  let cursor = 0;
  for (;;) {
    const block = nextBlock(cursor);
    if (block === null) break;
    cursor = block.end;
    if (block.header.startsWith("@")) {
      const inner = checkoutRiderCss(block.body);
      if (inner !== "") {
        const atRule = block.header.replace(/^@container\b/, "@media");
        kept.push(`${atRule} {\n${inner}\n}`);
      }
    } else if (wanted(block.header)) {
      kept.push(`${block.header} {${block.body}}`);
    }
  }
  return kept.join("\n");
}

/**
 * The colour tokens the block's rules read, supplied by the rider against the
 * *document* rather than the Style tab: ink inherits the page's text colour
 * and every other value is an alpha mix of `currentColor` (or transparent).
 * The section therefore paints in the sales page's own palette — a dark
 * import stays dark, a light one stays light — and carries no colour of its
 * own beyond those mixes.
 */
const RIDER_COLOR_VARS: Record<string, string> = {
  "--sfv-ink": "inherit",
  "--sfv-soft": "color-mix(in srgb, currentColor 62%, transparent)",
  "--sfv-line": "color-mix(in srgb, currentColor 20%, transparent)",
  "--sfv-line-strong": "color-mix(in srgb, currentColor 34%, transparent)",
  "--sfv-bg": "transparent",
  "--sfv-brand": "currentColor",
  "--sfv-brand-soft": "color-mix(in srgb, currentColor 10%, transparent)",
  "--sfv-brand-line": "color-mix(in srgb, currentColor 30%, transparent)",
};

/** The two colours the pay button borrows from the page's own buttons. */
export interface PayButtonColors {
  background: string;
  color: string;
}

/** Strict colour grammar — a page's CSS never lands in the sheet as raw text. */
const COLOR_VALUE =
  /^(#[0-9a-f]{3,8}|rgba?\(\s*[0-9.,%\s/]+\)|hsla?\(\s*[0-9.,%\s/deg]+\))$/i;

function relativeLuminance(color: string): number | null {
  let r: number;
  let g: number;
  let b: number;
  const hex = color.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const part = (value: string): number =>
      parseInt(value.length === 1 ? value + value : value, 16);
    if (hex.length === 3 || hex.length === 4) {
      r = part(hex[0] as string);
      g = part(hex[1] as string);
      b = part(hex[2] as string);
    } else if (hex.length === 6 || hex.length === 8) {
      r = part(hex.slice(0, 2));
      g = part(hex.slice(2, 4));
      b = part(hex.slice(4, 6));
    } else {
      return null;
    }
  } else {
    const rgb = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!rgb) return null;
    r = Number(rgb[1]);
    g = Number(rgb[2]);
    b = Number(rgb[3]);
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Readable text for a background we couldn't read a colour from. */
function inkOn(background: string): string {
  const luminance = relativeLuminance(background);
  return luminance !== null && luminance > 0.6 ? "#14181F" : "#FFFFFF";
}

/**
 * The page's own primary button colour, lifted from its stylesheet — an
 * imported page paints its buttons itself, and the checkout's pay button
 * should look like one of them instead of a tint of the text colour.
 *
 * Reads only `<style>` blocks, resolves custom properties through `var()`,
 * and considers button-ish selectors (`.btn`, `.button`, `.cta`, `button`).
 * The most common background wins; ties keep the earliest rule (usually the
 * base class, before per-section overrides). Null when the page declares no
 * usable button colour — the rider then keeps its text-tinted button.
 */
export function primaryButtonColors(html: string | null): PayButtonColors | null {
  if (!html) return null;
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  if (!css) return null;

  const vars = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    vars.set(match[1] as string, (match[2] as string).trim());
  }
  const resolve = (value: string, depth = 0): string => {
    const next = value.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
      (_all, name: string, fallback?: string) => vars.get(name) ?? fallback ?? "",
    );
    return depth < 5 && next.includes("var(") ? resolve(next, depth + 1) : next.trim();
  };

  const BUTTON_RULE = /(^|[\s,>+~])\.(?:btn|button|cta)\b|(^|[\s,>+~])button\b/i;
  const groups = new Map<string, { background: string; color: string; first: number; count: number }>();
  let index = 0;
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] as string).trim();
    if (!BUTTON_RULE.test(selector)) continue;
    const order = index;
    index += 1;
    const body = match[2] as string;
    const backgroundRaw = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i)?.[1];
    if (!backgroundRaw) continue;
    const background = resolve(backgroundRaw);
    if (!COLOR_VALUE.test(background)) continue;
    const colorRaw = body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1];
    const color = colorRaw ? resolve(colorRaw) : "";
    const key = background.toLowerCase();
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      if (group.color === "" && COLOR_VALUE.test(color)) group.color = color;
    } else {
      groups.set(key, {
        background,
        color: COLOR_VALUE.test(color) ? color : inkOn(background),
        first: order,
        count: 1,
      });
    }
  }

  let best: { background: string; color: string; first: number; count: number } | null = null;
  for (const group of groups.values()) {
    if (!best || group.count > best.count || (group.count === best.count && group.first < best.first)) {
      best = group;
    }
  }
  return best ? { background: best.background, color: best.color } : null;
}

/**
 * Where the checkout block lands in a document: before the page's own
 * `<footer>` when it has one — the block sells, the footer closes the page —
 * and otherwise at the end of the body (or of the markup, for the shell's
 * body fragment, which carries no tags of its own). A stray `<footer>` after
 * `</body>` doesn't count; the end of the body wins there.
 */
function placeCheckout(html: string, block: string): string {
  const footer = html.search(/<footer(?=[\s/>])/i);
  const bodyEnd = html.search(/<\/body\s*>/i);
  const at = footer !== -1 && (bodyEnd === -1 || footer < bodyEnd) ? footer : bodyEnd;
  return at === -1 ? html + block : html.slice(0, at) + block + html.slice(at);
}

/**
 * The checkout rider: what a complete document (an imported page, or a full
 * document typed into the Code view) gains when the page sells. The document
 * keeps its own `<head>`, styles and scripts — only the block's `<style>`,
 * markup and cart script are added (the sheet lands in `<head>` when one
 * exists, so it follows spec; the markup lands above the page's footer, the
 * script at the end of the body). A scoped box-sizing reset keeps the block's
 * paddings honest on pages that don't set one globally.
 */
function rideCheckout(page: SalesPage, document: string, products: Product[]): string {
  if (!checkoutEnabled(page, products)) return document;

  // Type and scale tokens still come from the page's Style; every colour
  // token is withheld here and supplied by RIDER_COLOR_VARS instead — the
  // block must take the document's colours, not the Style tab's.
  const scale = canvasStyleVars(page.style);
  const scaleVar = (key: string): string => scale[key] ?? "";
  const vars = {
    fontFamily: scaleVar("fontFamily"),
    "--sp-font-head": scaleVar("--sp-font-head"),
    "--sp-fs": scaleVar("--sp-fs"),
    "--sp-space": scaleVar("--sp-space"),
    "--sp-rscale": scaleVar("--sp-rscale"),
    "--sp-wrapmax": scaleVar("--sp-wrapmax"),
    ...RIDER_COLOR_VARS,
  };
  const payColors = primaryButtonColors(document);
  const rideVars = esc(styleAttribute(vars));
  const sheet =
    `<style>\n` +
    `.scoRide, .scoRide *, .scoRide *::before, .scoRide *::after {\n  box-sizing: border-box;\n}\n` +
    `${checkoutRiderCss(appCss)}\n` +
    // The primary action matches the page's own primary button when it has
    // one; with no such colour it falls back to a tint of the page's text,
    // which reads on light and dark pages alike.
    (payColors
      ? `.scoRide .sco__pay {\n  background: ${payColors.background};\n  color: ${payColors.color};\n}\n`
      : `.scoRide .sco__pay {\n  background: color-mix(in srgb, currentColor 16%, transparent);\n  color: currentColor;\n}\n`) +
    // The busy spinner's keyframes aren't class-scoped, so the rider's rule
    // extractor can't carry them — they ship here with the block.
    `@keyframes sco-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n` +
    // The app's error red is tuned for a light theme; mixed with the page's
    // text it stays legible on either.
    `.scoRide .sco__err {\n  color: color-mix(in srgb, #b3261e 72%, currentColor);\n}\n` +
    `</style>`;
  const block = `<div class="scoRide" style="${rideVars}">${checkoutMarkup(page, products)}</div>\n`;
  const script = `<script>\n${CHECKOUT_SCRIPT}\n</script>\n`;

  // Style sheet into <head> when the document has one, else before the block.
  const headAt = document.search(/<\/head\s*>/i);
  const withSheet = headAt === -1 ? document : document.slice(0, headAt) + `${sheet}\n` + document.slice(headAt);

  // The section sits above the page's footer; the cart script runs last, once
  // the whole body — footer included — has parsed.
  const withBlock = placeCheckout(withSheet, block);
  const bodyAt = withBlock.search(/<\/body\s*>/i);
  return bodyAt === -1 ? withBlock + script : withBlock.slice(0, bodyAt) + script + withBlock.slice(bodyAt);
}

interface DocumentOptions {
  /**
   * The page's public address — baked into `<link rel="canonical">` and
   * `og:url`. Omitted in contexts with no meaningful origin.
   */
  canonicalUrl?: string;
  /**
   * The page's checkout products, resolved and in listing order (the save
   * pipeline owns the fetch). When present and the block is toggled on, the
   * document carries the checkout section; without them the page renders
   * content-only, exactly as before.
   */
  checkoutProducts?: Product[];
}

/** The page's whole standalone document, ready for R2. */
export function buildSalesPageDocument(page: SalesPage, options: DocumentOptions = {}): string {
  const type = htmlTypeOf(page);
  const live = htmlFor(page, type);
  const products = options.checkoutProducts ?? [];

  // A complete document owns its own <head> (title, styles, scripts) — the
  // importer and the Code view author it in full, so its markup ships
  // untouched. Only the checkout rides along: the block, a scoped sheet of
  // its own rules and the cart script, the block set above the page's footer.
  if (live !== null && isFullDocumentHtml(live)) return rideCheckout(page, live, products);

  // The live document's markup when one exists, else the sections rendered
  // for a no-JavaScript page: FAQ answers open, carousel slides stacked. The
  // checkout joins above the footer section, like it does on a ridden page.
  const bodyMarkup = placeCheckout(
    live ?? renderSectionsHtml(page.sections, page.style.iconSet, true),
    checkoutMarkup(page, products),
  );

  return documentShell(page, bodyMarkup, options);
}

/** Head + themed wrapper around one body markup string. */
function documentShell(page: SalesPage, bodyMarkup: string, options: DocumentOptions): string {
  const checkoutProducts = options.checkoutProducts ?? [];
  const title = page.seo.title.trim() || page.name;
  const description = page.seo.description.trim();
  const keywords = page.seo.keywords.trim();
  const ogTitle = page.og.title.trim() || title;
  const ogDescription = page.og.description.trim() || description;
  const ogImage = absoluteUrl(page.og.image.trim(), options.canonicalUrl);

  const heads: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
  ];
  if (description) heads.push(meta("description", description));
  if (keywords) heads.push(meta("keywords", keywords));
  if (options.canonicalUrl) {
    heads.push(`<link rel="canonical" href="${esc(options.canonicalUrl)}">`);
  }

  // Open Graph + Twitter card — the share preview every scraper reads.
  heads.push(meta("og:type", "website", true));
  heads.push(meta("og:title", ogTitle, true));
  if (options.canonicalUrl) heads.push(meta("og:url", options.canonicalUrl, true));
  if (ogDescription) heads.push(meta("og:description", ogDescription, true));
  if (ogImage) heads.push(meta("og:image", ogImage, true));
  heads.push(meta("twitter:card", ogImage ? "summary_large_image" : "summary"));
  heads.push(meta("twitter:title", ogTitle));
  if (ogDescription) heads.push(meta("twitter:description", ogDescription));
  if (ogImage) heads.push(meta("twitter:image", ogImage));

  // The page's two families, exact weights, one link each.
  const fonts = new Set<string>();
  for (const family of [page.style.fontHead, page.style.fontBody]) {
    const href = googleFontHref(family);
    if (href) fonts.add(href);
  }
  for (const href of fonts) {
    heads.push(`<link rel="stylesheet" href="${esc(href)}">`);
  }

  return (
    "<!doctype html>\n" +
    '<html lang="en">\n<head>\n' +
    `${heads.join("\n")}\n` +
    // Section + kit styles inline: the document has no origin to fetch them
    // from and must paint with zero requests beyond fonts and images.
    `<style>\n${uiCss}\n${appCss}\n</style>\n` +
    "</head>\n<body>\n" +
    `<div class="spv" style="${esc(styleAttribute(canvasStyleVars(page.style)))}">` +
    `<div class="sf-frame__site spv__canvas">${bodyMarkup}</div>` +
    "</div>\n" +
    // The cart script rides only when the checkout block is in the markup.
    (checkoutEnabled(page, checkoutProducts)
      ? `<script>\n${CHECKOUT_SCRIPT}\n</script>\n`
      : "") +
    "</body>\n</html>\n"
  );
}
