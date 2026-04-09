"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LLM_JUDGE_OPTIONS } from "@/lib/eval-options";
import { FAILURE_OPTIONS } from "@/lib/evaluators";
import {
  CheckCircle2,
  FlaskConical,
  Loader2,
  XCircle,
} from "lucide-react";

interface TraceSummary {
  id: string;
  entry_point: string;
  trace_status: string;
  source_type: string | null;
  mode: string | null;
  model_name: string | null;
  started_at: string;
  latency_ms: number | null;
  error_message: string | null;
  review_count: number;
  review_state: "reviewed" | "unreviewed";
  latest_feedback_type: string | null;
}

interface TraceDetail {
  trace: Record<string, unknown>;
  spans: Record<string, unknown>[];
  results: Record<string, unknown>[];
  feedback: Record<string, unknown>[];
  labels: Record<string, unknown>[];
}

interface MetricsResponse {
  setupRequired?: boolean;
  hint?: string;
  requiredSqlPath?: string;
  summary: {
    totalTraces: number;
    successRate: number;
    hvftrCount: number;
    hvftrRate: number;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    labeledTraces: number;
    pendingReviewCount: number;
    reviewCoverageRate: number;
  };
  feedback: {
    saveCount: number;
    skipCount: number;
    saveRate: number;
    savedInsightCount: number;
  };
  flywheel: {
    savedInsightCount: number;
    reusedSavedInsightCount: number;
    reusedThinkTraceCount: number;
    reuseRate: number;
    reuseTurnRate: number;
  };
  pipeline: Array<{
    entryPoint: string;
    total: number;
    successCount: number;
    errorCount: number;
    successRate: number;
    avgLatencyMs: number | null;
  }>;
  evaluators: Array<{
    name: string;
    type: string;
    total: number;
    passRate: number;
    failCount: number;
  }>;
  failureCodes: Array<{
    code: string;
    count: number;
  }>;
}

const ENTRY_POINTS = ["all", "feed", "think", "save_insight"] as const;
const STATUS_OPTIONS = ["all", "running", "success", "error", "partial"] as const;
const REVIEW_STATES = ["all", "unreviewed", "reviewed"] as const;
function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap break-all overflow-x-auto">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default function EvalsPage() {
  const [entryPoint, setEntryPoint] =
    useState<(typeof ENTRY_POINTS)[number]>("all");
  const [status, setStatus] =
    useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [reviewState, setReviewState] =
    useState<(typeof REVIEW_STATES)[number]>("all");
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [setupRequired, setSetupRequired] = useState<{
    hint?: string;
    requiredSqlPath?: string;
  } | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [isRunningEvals, setIsRunningEvals] = useState(false);
  const [isRunningJudge, setIsRunningJudge] = useState(false);
  const [failureCode, setFailureCode] = useState("");
  const [passFail, setPassFail] = useState("pass");
  const [notes, setNotes] = useState("");
  const [datasetName, setDatasetName] = useState("manual-review");
  const [judgeName, setJudgeName] =
    useState<(typeof LLM_JUDGE_OPTIONS)[number]["name"]>("think_mode_fit");
  const [refreshKey, setRefreshKey] = useState(0);

  const selectedTrace = useMemo(
    () => traces.find((trace) => trace.id === selectedTraceId) ?? null,
    [selectedTraceId, traces]
  );

  const enabledJudges = useMemo(() => {
    const currentEntryPoint = selectedTrace?.entry_point;
    return LLM_JUDGE_OPTIONS.filter((item) =>
      currentEntryPoint
        ? (item.entryPoints as readonly string[]).includes(currentEntryPoint)
        : false
    );
  }, [selectedTrace?.entry_point]);

  useEffect(() => {
    if (
      enabledJudges.length > 0 &&
      !enabledJudges.some((item) => item.name === judgeName)
    ) {
      setJudgeName(enabledJudges[0].name);
    }
  }, [enabledJudges, judgeName]);

  useEffect(() => {
    async function loadTraces() {
      setIsLoadingList(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", "30");
        params.set("reviewState", reviewState);
        if (entryPoint !== "all") params.set("entryPoint", entryPoint);
        if (status !== "all") params.set("status", status);

        const res = await fetch(`/api/evals/traces?${params.toString()}`);
        const payload = await res.json();
        if (payload.setupRequired) {
          setSetupRequired({
            hint: payload.hint,
            requiredSqlPath: payload.requiredSqlPath,
          });
          setTraces([]);
          setSelectedTraceId(null);
          return;
        }
        const nextTraces = payload.traces ?? [];
        setSetupRequired(null);
        setTraces(nextTraces);

        if (!selectedTraceId && nextTraces.length > 0) {
          setSelectedTraceId(nextTraces[0].id);
          return;
        }

        if (
          selectedTraceId &&
          !nextTraces.some((trace: TraceSummary) => trace.id === selectedTraceId)
        ) {
          setSelectedTraceId(nextTraces[0]?.id ?? null);
        }
      } finally {
        setIsLoadingList(false);
      }
    }

    void loadTraces();
  }, [entryPoint, reviewState, selectedTraceId, status, refreshKey]);

  useEffect(() => {
    async function loadMetrics() {
      setIsLoadingMetrics(true);
      try {
        const res = await fetch("/api/evals/metrics");
        const payload = await res.json();
        if (payload.setupRequired) {
          setSetupRequired({
            hint: payload.hint,
            requiredSqlPath: payload.requiredSqlPath,
          });
        }
        setMetrics(payload);
      } finally {
        setIsLoadingMetrics(false);
      }
    }

    void loadMetrics();
  }, [refreshKey]);

  useEffect(() => {
    if (!selectedTraceId) {
      setDetail(null);
      return;
    }

    async function loadDetail() {
      setIsLoadingDetail(true);
      try {
        const res = await fetch(`/api/evals/traces?traceId=${selectedTraceId}`);
        const payload = await res.json();
        if (payload.setupRequired) {
          setSetupRequired({
            hint: payload.hint,
            requiredSqlPath: payload.requiredSqlPath,
          });
          setDetail(null);
          return;
        }
        setDetail(payload);
      } finally {
        setIsLoadingDetail(false);
      }
    }

    void loadDetail();
  }, [selectedTraceId, refreshKey]);

  async function handleSubmitLabel() {
    if (!selectedTraceId) return;

    const res = await fetch("/api/evals/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        traceId: selectedTraceId,
        datasetName: datasetName || "manual-review",
        failureCode: failureCode || null,
        passFail: passFail === "unknown" ? null : passFail === "pass",
        notes,
      }),
    });

    if (res.ok) {
      setFailureCode("");
      setNotes("");
      setRefreshKey((value) => value + 1);
    }
  }

  async function handleRunCodeEvals() {
    if (!selectedTraceId) return;
    setIsRunningEvals(true);
    try {
      await fetch("/api/evals/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traceId: selectedTraceId }),
      });
      setRefreshKey((value) => value + 1);
    } finally {
      setIsRunningEvals(false);
    }
  }

  async function handleRunJudge() {
    if (!selectedTraceId || enabledJudges.length === 0) return;
    setIsRunningJudge(true);
    try {
      await fetch("/api/evals/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traceId: selectedTraceId,
          judgeName,
        }),
      });
      setRefreshKey((value) => value + 1);
    } finally {
      setIsRunningJudge(false);
    }
  }

  const runCodeEvalsFromKey = useEffectEvent(() => {
    void handleRunCodeEvals();
  });

  const runJudgeFromKey = useEffectEvent(() => {
    void handleRunJudge();
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target?.isContentEditable
      ) {
        return;
      }

      if ((event.key === "j" || event.key === "ArrowDown") && traces.length > 0) {
        event.preventDefault();
        const index = traces.findIndex((trace) => trace.id === selectedTraceId);
        const nextIndex = index >= 0 ? Math.min(index + 1, traces.length - 1) : 0;
        setSelectedTraceId(traces[nextIndex].id);
      }

      if ((event.key === "k" || event.key === "ArrowUp") && traces.length > 0) {
        event.preventDefault();
        const index = traces.findIndex((trace) => trace.id === selectedTraceId);
        const nextIndex = index >= 0 ? Math.max(index - 1, 0) : 0;
        setSelectedTraceId(traces[nextIndex].id);
      }

      if (event.key === "e" && selectedTraceId && !isRunningEvals) {
        event.preventDefault();
        runCodeEvalsFromKey();
      }

      if (
        event.key === "l" &&
        selectedTraceId &&
        enabledJudges.length > 0 &&
        !isRunningJudge
      ) {
        event.preventDefault();
        runJudgeFromKey();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    enabledJudges.length,
    isRunningEvals,
    isRunningJudge,
    selectedTraceId,
    traces,
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <div className="space-y-1">
        <h1 className="text-[30px] font-bold">Evals</h1>
        <p className="text-sm text-muted-foreground">
          审 trace、打标签、跑自动评估，并跟踪飞轮 save / reuse 的真实效果
        </p>
        <p className="text-xs text-muted-foreground">
          快捷键：`J/K` 切换 trace，`E` 运行 code eval，`L` 运行当前 judge
        </p>
      </div>

      {setupRequired && (
        <Card className="border-amber-300 bg-amber-50/70">
          <CardContent className="pt-6 space-y-2">
            <div className="text-sm font-medium text-amber-900">
              Evals 基础表尚未在远程 Supabase 创建
            </div>
            <div className="text-sm text-amber-800">
              {setupRequired.hint ?? "请先执行评估相关 migration。"}
            </div>
            <div className="text-xs text-amber-700">
              SQL: {setupRequired.requiredSqlPath ?? "supabase/migrations/add-evals.sql"}
            </div>
          </CardContent>
        </Card>
      )}

      {!setupRequired && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">HVFTR</div>
            <div className="mt-2 text-3xl font-semibold">
              {isLoadingMetrics || !metrics
                ? "..."
                : formatPercent(metrics.summary.hvftrRate)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {metrics
                ? `${metrics.summary.hvftrCount} / ${metrics.summary.totalTraces} 高价值轮次`
                : "高价值飞轮轮次占比"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Review Coverage</div>
            <div className="mt-2 text-3xl font-semibold">
              {isLoadingMetrics || !metrics
                ? "..."
                : formatPercent(metrics.summary.reviewCoverageRate)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {metrics
                ? `${metrics.summary.pendingReviewCount} 条待审`
                : "人工审查覆盖率"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Save / Reuse</div>
            <div className="mt-2 text-3xl font-semibold">
              {isLoadingMetrics || !metrics
                ? "..."
                : `${metrics.flywheel.reusedSavedInsightCount}/${metrics.flywheel.savedInsightCount}`}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {metrics
                ? `reuse ${formatPercent(metrics.flywheel.reuseRate)} · save ${metrics.feedback.saveCount}`
                : "已保存洞察中的后续复用情况"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Health</div>
            <div className="mt-2 text-3xl font-semibold">
              {isLoadingMetrics || !metrics
                ? "..."
                : formatPercent(metrics.summary.successRate)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {metrics
                ? `p50 ${metrics.summary.p50LatencyMs ?? "n/a"} ms · p95 ${metrics.summary.p95LatencyMs ?? "n/a"} ms`
                : "成功率与延迟"}
            </div>
          </CardContent>
        </Card>
        </div>
      )}

      {metrics && !setupRequired && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {metrics.pipeline.map((item) => (
                <div
                  key={item.entryPoint}
                  className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-sm"
                >
                  <div className="font-medium">{item.entryPoint}</div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${Math.round(item.successRate * 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.successCount}/{item.total}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top Failures</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {metrics.failureCodes.length === 0 && (
                <div className="text-sm text-muted-foreground">暂无 failure code</div>
              )}
              {metrics.failureCodes.map((item) => (
                <div
                  key={item.code}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                >
                  <span className="break-all">{item.code}</span>
                  <Badge variant="outline">{item.count}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evaluator Pass Rate</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {metrics.evaluators.slice(0, 6).map((item) => (
                <div
                  key={item.name}
                  className="rounded-lg border p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.name}</span>
                    <Badge variant="outline">{formatPercent(item.passRate)}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.type} · {item.total} runs · {item.failCount} fails
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="space-y-4">
            <CardTitle className="text-base">Trace Queue</CardTitle>

            <div className="space-y-3">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">入口</div>
                <div className="flex flex-wrap gap-2">
                  {ENTRY_POINTS.map((item) => (
                    <Button
                      key={item}
                      size="sm"
                      variant={entryPoint === item ? "default" : "outline"}
                      onClick={() => setEntryPoint(item)}
                    >
                      {item}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs text-muted-foreground">状态</div>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((item) => (
                    <Button
                      key={item}
                      size="sm"
                      variant={status === item ? "default" : "outline"}
                      onClick={() => setStatus(item)}
                    >
                      {item}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs text-muted-foreground">审查状态</div>
                <div className="flex flex-wrap gap-2">
                  {REVIEW_STATES.map((item) => (
                    <Button
                      key={item}
                      size="sm"
                      variant={reviewState === item ? "default" : "outline"}
                      onClick={() => setReviewState(item)}
                    >
                      {item}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-2">
            {isLoadingList && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载中...
              </div>
            )}

            {!isLoadingList && traces.length === 0 && (
              <div className="text-sm text-muted-foreground">暂无 trace</div>
            )}

            {traces.map((trace) => (
              <button
                key={trace.id}
                onClick={() => setSelectedTraceId(trace.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  selectedTraceId === trace.id
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{trace.entry_point}</span>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        trace.review_state === "reviewed" ? "secondary" : "outline"
                      }
                    >
                      {trace.review_state}
                    </Badge>
                    <Badge
                      variant={
                        trace.trace_status === "success" ? "secondary" : "outline"
                      }
                    >
                      {trace.trace_status}
                    </Badge>
                  </div>
                </div>

                <div className="mt-1 text-xs text-muted-foreground">
                  {trace.mode || trace.source_type || "n/a"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {new Date(trace.started_at).toLocaleString("zh-CN")}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{trace.review_count} labels</span>
                  {trace.latest_feedback_type && (
                    <span>feedback: {trace.latest_feedback_type}</span>
                  )}
                  {trace.latency_ms && <span>{trace.latency_ms} ms</span>}
                </div>

                {trace.error_message && (
                  <div className="mt-1 line-clamp-2 text-xs text-destructive">
                    {trace.error_message}
                  </div>
                )}
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {!selectedTraceId && (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                选择一条 trace 查看详情
              </CardContent>
            </Card>
          )}

          {selectedTraceId && isLoadingDetail && (
            <Card>
              <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载 trace 详情...
              </CardContent>
            </Card>
          )}

          {detail && !isLoadingDetail && (
            <>
              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="text-base">Trace Overview</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {String(detail.trace.entry_point)} ·{" "}
                      {String(detail.trace.trace_status)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRunCodeEvals}
                      disabled={isRunningEvals}
                    >
                      {isRunningEvals ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <FlaskConical className="mr-1 h-4 w-4" />
                      )}
                      运行代码评估
                    </Button>

                    <select
                      value={judgeName}
                      onChange={(e) =>
                        setJudgeName(
                          e.target.value as (typeof LLM_JUDGE_OPTIONS)[number]["name"]
                        )
                      }
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                      disabled={enabledJudges.length === 0}
                    >
                      {enabledJudges.length === 0 && (
                        <option value="">当前入口暂无 judge</option>
                      )}
                      {enabledJudges.map((item) => (
                        <option key={item.name} value={item.name}>
                          {item.label}
                        </option>
                      ))}
                    </select>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRunJudge}
                      disabled={isRunningJudge || enabledJudges.length === 0}
                    >
                      {isRunningJudge ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <FlaskConical className="mr-1 h-4 w-4" />
                      )}
                      运行 LLM Judge
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                    <div>
                      <div className="text-xs text-muted-foreground">Trace ID</div>
                      <div className="break-all">{String(detail.trace.id)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">模型</div>
                      <div>{String(detail.trace.model_name || "n/a")}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">延迟</div>
                      <div>
                        {detail.trace.latency_ms
                          ? `${String(detail.trace.latency_ms)} ms`
                          : "n/a"}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div>
                      <div className="mb-2 text-xs text-muted-foreground">
                        Request Payload
                      </div>
                      <JsonBlock value={detail.trace.request_payload} />
                    </div>
                    <div>
                      <div className="mb-2 text-xs text-muted-foreground">
                        Response Payload
                      </div>
                      <JsonBlock value={detail.trace.response_payload} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Spans</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {detail.spans.length === 0 && (
                    <div className="text-sm text-muted-foreground">暂无 span</div>
                  )}
                  {detail.spans.map((span) => (
                    <div key={String(span.id)} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">
                          {String(span.span_name)}
                        </div>
                        <Badge
                          variant={
                            span.span_status === "success" ? "secondary" : "outline"
                          }
                        >
                          {String(span.span_status)}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {span.latency_ms ? `${String(span.latency_ms)} ms` : "n/a"}
                      </div>
                      {Boolean(span.error_message) && (
                        <div className="mt-1 text-xs text-destructive">
                          {String(span.error_message)}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Auto Eval Results</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {detail.results.length === 0 && (
                    <div className="text-sm text-muted-foreground">
                      暂无自动评估结果
                    </div>
                  )}
                  {detail.results.map((result) => (
                    <div key={String(result.id)} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">
                          {String(result.evaluator_name)}
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          {result.pass_fail === true && (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          )}
                          {result.pass_fail === false && (
                            <XCircle className="h-4 w-4 text-red-600" />
                          )}
                          <Badge variant="outline">
                            {String(result.evaluator_type)}
                          </Badge>
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {String(result.reason || "")}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Manual Review</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">
                      Dataset Name
                    </div>
                    <Input
                      value={datasetName}
                      onChange={(e) => setDatasetName(e.target.value)}
                      placeholder="manual-review / think_mode_gold_dev ..."
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs text-muted-foreground">
                        Failure Code
                      </div>
                      <select
                        value={failureCode}
                        onChange={(e) => setFailureCode(e.target.value)}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      >
                        <option value="">未选择</option>
                        {FAILURE_OPTIONS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="mb-1 text-xs text-muted-foreground">
                        Pass / Fail
                      </div>
                      <select
                        value={passFail}
                        onChange={(e) => setPassFail(e.target.value)}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      >
                        <option value="pass">pass</option>
                        <option value="fail">fail</option>
                        <option value="unknown">unknown</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">Notes</div>
                    <Textarea
                      rows={4}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="记录第一个上游错误、根因判断或修复建议..."
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button onClick={handleSubmitLabel}>提交标注</Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Human Labels & Feedback
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Labels</div>
                    {detail.labels.length === 0 && (
                      <div className="text-sm text-muted-foreground">
                        暂无人工标签
                      </div>
                    )}
                    {detail.labels.map((label) => (
                      <div key={String(label.id)} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">
                            {String(label.failure_code || "未分类")}
                          </span>
                          <Badge variant="outline">
                            {label.pass_fail === null
                              ? "unknown"
                              : String(label.pass_fail)}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {String(label.dataset_name || "manual-review")}
                        </div>
                        {Boolean(label.notes) && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {String(label.notes)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Feedback</div>
                    {detail.feedback.length === 0 && (
                      <div className="text-sm text-muted-foreground">
                        暂无用户反馈
                      </div>
                    )}
                    {detail.feedback.map((item) => (
                      <div key={String(item.id)} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">
                            {String(item.feedback_type)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(String(item.created_at)).toLocaleString("zh-CN")}
                          </span>
                        </div>
                        {Boolean(item.feedback_text) && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {String(item.feedback_text)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
