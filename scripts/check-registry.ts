/**
 * Walks every model through every combination of its options and proves that each one
 * lands on a real price row. Run with `npm run check:registry`.
 *
 * A failure here means the composer could show a price the provider will not charge,
 * so this runs before every build.
 */
import { formatCredits, usdToMillicredits } from "../src/config/economy";
import { catalogEndpoint, knownEndpoint, matches, models, quoteJob, resolveValues, type Control, type Filled, type ModelDef } from "../src/registry";

function candidates(c: Control): unknown[] {
  switch (c.type) {
    case "select":
      return c.options.map((o) => o.value);
    case "slider":
      return [...new Set([c.min, c.default, c.max])];
    case "toggle":
      return [true, false];
    case "text":
      return ["", "sample"];
  }
}

function* product(lists: unknown[][]): Generator<unknown[]> {
  if (lists.length === 0) {
    yield [];
    return;
  }
  const [head, ...rest] = lists;
  for (const h of head) for (const tail of product(rest)) yield [h, ...tail];
}

function fills(model: ModelDef): Filled[] {
  const states = model.slots.map((s) => (s.min > 0 ? [s.min] : [0, 1]));
  return [...product(states)].map((combo) => Object.fromEntries(model.slots.map((s, i) => [s.id, combo[i] as number])));
}

const problems: string[] = [];
const rows: string[] = [];
let combos = 0;

for (const model of models) {
  const seen = new Set<string>();
  let low = Infinity;
  let high = 0;
  for (const filled of fills(model)) {
    for (const combo of product(model.controls.map(candidates))) {
      const raw = Object.fromEntries(model.controls.map((c, i) => [c.id, combo[i]]));
      const values = resolveValues(model, raw, filled);
      // A slot that is hidden for these values cannot be filled.
      if (model.slots.some((s) => (filled[s.id] ?? 0) > 0 && !matches(s.when, values, filled))) continue;
      for (const count of new Set([1, model.batch.max])) {
        const key = JSON.stringify([values, filled, count]);
        if (seen.has(key)) continue;
        seen.add(key);
        combos++;
        const prompt = model.prompt ? "A paper boat crosses a quiet pond at sunrise." : "";
        const q = quoteJob(model, { prompt, values, filled, count });
        const where = `${model.id} ${JSON.stringify(values)} slots=${JSON.stringify(filled)} count=${count}`;
        for (const [name, allowed] of Object.entries(catalogEndpoint(q.request.endpoint)?.headers ?? {})) {
          const sent = q.request.headers?.[name];
          if (sent === undefined) problems.push(`missing required header "${name}" on ${q.request.endpoint}: ${where}`);
          else if (allowed.length && !allowed.includes(sent)) problems.push(`header "${name}: ${sent}" not accepted by ${q.request.endpoint}: ${where}`);
        }
        if (!knownEndpoint(q.request.endpoint)) problems.push(`unknown endpoint ${q.request.endpoint}: ${where}`);
        else if (!q.exact) problems.push(`no price row on ${q.request.endpoint}: ${where}`);
        else if (!(q.usdPerJob > 0)) problems.push(`zero price on ${q.request.endpoint}: ${where}`);
        if (JSON.stringify(q.request).includes("undefined")) problems.push(`undefined in request: ${where}`);
        low = Math.min(low, q.millicredits);
        high = Math.max(high, q.millicredits);
      }
    }
  }
  rows.push(`${model.kind.padEnd(6)} ${model.id.padEnd(26)} ${model.status.padEnd(10)} ${formatCredits(low).padStart(8)} to ${formatCredits(high).padStart(8)} credits  (${seen.size} combinations)`);
}

function expectCredits(label: string, got: number, want: number) {
  if (got !== want) problems.push(`${label}: expected ${want} millicredits, got ${got}`);
}

// Known prices, worked by hand from the provider rate cards.
expectCredits("FLUX Schnell, 1 image ($0.003)", usdToMillicredits(0.003), 100);
{
  const m = models.find((x) => x.id === "flux-schnell")!;
  const values = resolveValues(m, {}, {});
  expectCredits("flux-schnell quote x1", quoteJob(m, { prompt: "x", values, filled: {}, count: 1 }).millicredits, 100);
  expectCredits("flux-schnell quote x4", quoteJob(m, { prompt: "x", values, filled: {}, count: 4 }).millicredits, 400);
}

// kie.ai prices that matched real generations exactly (creditsConsumed, 2026-11-20).
// A real charge is kie credits x $0.005; the member price is that x the margin, in 0.1 credit steps.
function expectKie(id: string, values: Record<string, string | boolean>, text: string, kieCredits: number, count = 1) {
  const m = models.find((x) => x.id === id);
  if (!m) return void problems.push(`missing model ${id}`);
  const v = resolveValues(m, values, {});
  const q = quoteJob(m, { prompt: text, values: v, filled: {}, count });
  const got = Math.round((q.usdPerJob / 0.005) * 100) / 100;
  if (Math.abs(got - kieCredits) > 0.01) problems.push(`${id} ${JSON.stringify(values)}: expected ${kieCredits} kie credits, got ${got}`);
}
expectKie("nano-banana-2", { resolution: "1K" }, "x", 8);
expectKie("nano-banana-pro", { resolution: "4K" }, "x", 24);
expectKie("gpt-image-2", { resolution: "2K" }, "x", 10);
expectKie("veo-3.1-lite", { duration: "4", resolution: "720p" }, "x", 30);
expectKie("veo-3.1-fast", { duration: "8", resolution: "1080p" }, "x", 65);
expectKie("kling-3-std", { duration: "3", audio: false }, "x", 45.3);
expectKie("kling-3-pro", { duration: "5", audio: true }, "x", 151);
expectKie("wan-3", { duration: "2", resolution: "480P" }, "x", 16);
expectKie("grok-imagine", { duration: "6", resolution: "480p" }, "x", 14.4);
expectKie("elevenlabs-v2", {}, "Olá! Este é um teste rápido de voz.", 12);
expectKie("suno-v6", {}, "x", 12);

const ids = models.map((m) => m.id);
for (const id of ids) if (ids.indexOf(id) !== ids.lastIndexOf(id)) problems.push(`duplicate model id ${id}`);

console.log(rows.join("\n"));
console.log(`\n${models.length} models, ${combos} combinations checked.`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.error("  " + p);
  process.exit(1);
}
console.log("Every combination has an exact price.");
