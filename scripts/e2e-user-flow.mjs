import fs from "node:fs";
import { createServerClient } from "@supabase/ssr";

function readEnv() {
  return Object.fromEntries(
    fs
      .readFileSync(".env.local", "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

async function readSse(response) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("SSE response has no body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = JSON.parse(line.slice(6));
      if (payload.phase === "error") {
        throw new Error(`SSE error: ${payload.error}`);
      }
      if (payload.phase === "done") {
        donePayload = payload;
      }
    }
  }

  if (!donePayload) {
    throw new Error("No done payload received from SSE endpoint");
  }

  return donePayload;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const env = readEnv();
  const baseUrl = getArg("base-url", "http://127.0.0.1:3000");
  const cookieJar = new Map();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return [...cookieJar.entries()].map(([name, value]) => ({ name, value }));
        },
        setAll(items) {
          for (const item of items) {
            cookieJar.set(item.name, item.value);
          }
        },
      },
    }
  );

  const { data: signInData, error: signInError } =
    await supabase.auth.signInWithPassword({
      email: env.TEST_USER_EMAIL,
      password: env.TEST_USER_PASSWORD,
    });

  if (signInError) {
    throw new Error(`Sign in failed: ${signInError.message}`);
  }

  assert(cookieJar.size > 0, "No auth cookies generated");
  const cookieHeader = [...cookieJar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

  const authedFetch = (path, init = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Cookie: cookieHeader,
      },
    });

  const pageChecks = [
    ["/feed", "Feed"],
    ["/think", "Think"],
    ["/evals", "Evals"],
  ];

  for (const [path, marker] of pageChecks) {
    const response = await authedFetch(path);
    const html = await response.text();
    assert(response.ok, `Page ${path} returned ${response.status}`);
    assert(html.includes(marker), `Page ${path} missing marker: ${marker}`);
  }

  const seed = Date.now();
  const feedInput = `AI native evals e2e seed ${seed}: 我在做一个认知飞轮产品，核心问题是如何把用户保存的洞察稳定回流到下一轮思考，并让检索和回答随使用次数提升。`;

  const feedResponse = await authedFetch("/api/feed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: feedInput,
      type: "text",
    }),
  });

  assert(feedResponse.ok, `/api/feed returned ${feedResponse.status}`);
  const feedDone = await readSse(feedResponse);
  const feedResult = feedDone.result;

  assert(feedResult?.id, "Feed result missing knowledge item id");
  assert(feedResult?.title, "Feed result missing title");
  assert(Array.isArray(feedResult?.tags), "Feed result missing tags");

  const knowledgeResponse = await authedFetch("/api/knowledge");
  assert(knowledgeResponse.ok, `/api/knowledge returned ${knowledgeResponse.status}`);
  const knowledgePayload = await knowledgeResponse.json();
  const storedItem = (knowledgePayload.items ?? []).find(
    (item) => item.id === feedResult.id
  );
  assert(storedItem, "New feed item not visible in knowledge API");

  const thinkResponse = await authedFetch("/api/think", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "coach",
      question: `围绕“用户保存的洞察如何回流到下一轮思考”这个问题，给我一个具体的改进方案。请结合我刚才存入的内容。`,
    }),
  });

  assert(thinkResponse.ok, `/api/think returned ${thinkResponse.status}`);
  const thinkDone = await readSse(thinkResponse);
  const thinkResult = thinkDone.result;

  assert(thinkDone.sessionId, "Think result missing sessionId");
  assert(thinkDone.traceId !== undefined, "Think result missing traceId field");
  assert(Array.isArray(thinkResult?.insights), "Think result missing insights");
  assert(thinkResult.insights.length > 0, "Think produced no insights");

  const saveResponse = await authedFetch("/api/think/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "save",
      sessionId: thinkDone.sessionId,
      traceId: thinkDone.traceId ?? null,
      insights: thinkResult.insights.slice(0, 2),
      note: "e2e smoke save",
    }),
  });

  assert(saveResponse.ok, `/api/think/save returned ${saveResponse.status}`);
  const savePayload = await saveResponse.json();
  assert(
    Array.isArray(savePayload.savedItemIds) && savePayload.savedItemIds.length > 0,
    "Save insight did not create knowledge items"
  );

  const compileDomain = feedResult.domain || "跨领域";

  const compileResponse = await authedFetch("/api/knowledge/compile", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      domain: compileDomain,
    }),
  });

  assert(compileResponse.ok, `/api/knowledge/compile returned ${compileResponse.status}`);
  const compilePayload = await compileResponse.json();
  assert(
    typeof compilePayload.compiled_content === "string" &&
      compilePayload.compiled_content.length > 0,
    "Compile did not return compiled_content"
  );

  const lintResponse = await authedFetch("/api/knowledge/lint", {
    method: "POST",
  });
  assert(lintResponse.ok, `/api/knowledge/lint returned ${lintResponse.status}`);
  const lintPayload = await lintResponse.json();
  assert(
    typeof lintPayload.totalItems === "number",
    "Lint did not return totalItems"
  );

  const evalsMetricsResponse = await authedFetch("/api/evals/metrics");
  const evalsMetricsPayload = await evalsMetricsResponse.json();
  assert(
    evalsMetricsResponse.ok || evalsMetricsResponse.status === 503,
    `/api/evals/metrics returned unexpected status ${evalsMetricsResponse.status}`
  );
  assert(
    evalsMetricsPayload.setupRequired || evalsMetricsPayload.summary,
    "Evals metrics returned neither setupRequired nor summary"
  );

  const evalsTraceResponse = await authedFetch("/api/evals/traces?limit=5");
  const evalsTracePayload = await evalsTraceResponse.json();
  assert(
    evalsTraceResponse.ok || evalsTraceResponse.status === 503,
    `/api/evals/traces returned unexpected status ${evalsTraceResponse.status}`
  );
  assert(
    evalsTracePayload.setupRequired || Array.isArray(evalsTracePayload.traces),
    "Evals traces returned neither setupRequired nor traces"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        userId: signInData.user?.id ?? null,
        feedItemId: feedResult.id,
        thinkSessionId: thinkDone.sessionId,
        savedItemIds: savePayload.savedItemIds,
        compiledDomain: compilePayload.domain ?? compileDomain,
        lintTotalItems: lintPayload.totalItems,
        evalsSetupRequired: Boolean(evalsMetricsPayload.setupRequired),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
