"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { LLM_JUDGE_OPTIONS } from "@/lib/eval-options";
import { FAILURE_OPTIONS } from "@/lib/evaluators";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  GitBranch,
  Loader2,
  Radar,
  ShieldAlert,
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
    hvftrEligibleCount: number;
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
  overview: {
    autoEvalCoverageRate: number;
    judgeCoverageRate: number;
    guardrailFailRate: number;
    trends: Array<{
      day: string;
      totalTraces: number;
      successRate: number;
      hvftrRate: number;
      autoEvalCoverageRate: number;
      judgeCoverageRate: number | null;
      reviewCoverageRate: number;
      guardrailFailRate: number;
    }>;
    funnel: Array<{
      id: string;
      label: string;
      count: number;
      rate: number;
    }>;
    entryPoints: Array<{
      entryPoint: string;
      total: number;
      successCount: number;
      errorCount: number;
      successRate: number;
      qualityCount: number;
      qualityRate: number;
      autoEvalCoverageRate: number;
      judgeCoverageRate: number | null;
      guardrailFailCount: number;
      guardrailFailRate: number;
      reviewCoverageRate: number;
      pendingReviewCount: number;
      hvftrCount: number;
      avgLatencyMs: number | null;
      p95LatencyMs: number | null;
    }>;
  };
  diagnosis: {
    labelHotspots: Array<{
      code: string;
      count: number;
      entryPoints: string[];
      latestCreatedAt: string;
    }>;
    automatedHotspots: Array<{
      evaluatorName: string;
      evaluatorType: string;
      count: number;
      entryPoints: string[];
      exampleTraceIds: string[];
    }>;
    regressions: Array<{
      entryPoint: string;
      metric: string;
      metricLabel: string;
      currentRate: number;
      previousRate: number;
      delta: number;
      regressionAmount: number;
      currentTotal: number;
      previousTotal: number;
    }>;
    evaluatorByEntryPoint: Array<{
      entryPoint: string;
      evaluatorName: string;
      evaluatorType: string;
      total: number;
      passRate: number;
      failCount: number;
    }>;
    coverage: {
      tracesWithoutAutoEvalCount: number;
      tracesWithoutJudgeCount: number;
      highPriorityPendingCount: number;
      unreviewedByEntryPoint: Array<{
        entryPoint: string;
        pendingReviewCount: number;
      }>;
    };
  };
  review: {
    pendingReviewCount: number;
    highPriorityPendingCount: number;
    unreviewedByEntryPoint: Array<{
      entryPoint: string;
      pendingReviewCount: number;
    }>;
  };
}

const VIEW_TABS = [
  { value: "overview", label: "Overview", icon: GitBranch },
  { value: "diagnosis", label: "Diagnosis", icon: Radar },
  { value: "trace-lab", label: "Trace Lab", icon: FlaskConical },
  { value: "review-queue", label: "Review Queue", icon: ClipboardList },
] as const;

const ENTRY_POINTS = [
  "all",
  "feed",
  "think",
  "save_insight",
  "compile",
  "lint",
] as const;
const STATUS_OPTIONS = ["all", "running", "success", "error", "partial"] as const;
const REVIEW_STATES = ["all", "unreviewed", "reviewed"] as const;

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function formatPercent(value: number | null) {
  if (value == null) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function formatDelta(value: number) {
  const points = Math.round(value * 100);
  return `${points > 0 ? "+" : ""}${points}pp`;
}

function formatDay(day: string) {
  return day.slice(5);
}

function heatTone(passRate: number) {
  if (passRate >= 0.9) return "border-emerald-500/30 bg-emerald-500/12";
  if (passRate >= 0.75) return "border-lime-500/30 bg-lime-500/10";
  if (passRate >= 0.6) return "border-amber-500/30 bg-amber-500/12";
  return "border-red-500/30 bg-red-500/12";
}

function MetricCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-2 text-3xl font-semibold">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </CardContent>
    </Card>
  );
}

function EmptyCard({ title }: { title: string }) {
  return (
    <Card>
      <CardContent className="pt-6 text-sm text-muted-foreground">
        {title}
      </CardContent>
    </Card>
  );
}

function TrendRow({
  label,
  description,
  trends,
  valueKey,
  inverse = false,
}: {
  label: string;
  description: string;
  trends: MetricsResponse["overview"]["trends"];
  valueKey:
    | "successRate"
    | "hvftrRate"
    | "autoEvalCoverageRate"
    | "reviewCoverageRate"
    | "guardrailFailRate";
  inverse?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <div className="text-xs text-muted-foreground">
          最近 {trends.length} 天
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {trends.map((trend) => {
          const rawValue = trend[valueKey];
          const value = typeof rawValue === "number" ? rawValue : 0;
          const height = Math.max(10, Math.round(value * 100));
          return (
            <div key={`${label}-${trend.day}`} className="space-y-1 text-center">
              <div className="flex h-28 items-end justify-center rounded-md bg-muted/40 px-2 pb-2">
                <div
                  className={`w-full rounded-sm ${
                    inverse ? "bg-red-500/70" : "bg-primary/75"
                  }`}
                  style={{ height: `${height}%` }}
                />
              </div>
              <div className="text-[11px] text-muted-foreground">{formatDay(trend.day)}</div>
              <div className="text-[11px] font-medium">{formatPercent(value)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TraceList({
  traces,
  isLoading,
  selectedTraceId,
  onSelect,
}: {
  traces: TraceSummary[];
  isLoading: boolean;
  selectedTraceId: string | null;
  onSelect: (traceId: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载中...
      </div>
    );
  }

  if (traces.length === 0) {
    return <div className="text-sm text-muted-foreground">暂无 trace</div>;
  }

  return (
    <div className="space-y-2">
      {traces.map((trace) => (
        <button
          key={trace.id}
          onClick={() => onSelect(trace.id)}
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
            {trace.latency_ms != null && <span>{trace.latency_ms} ms</span>}
          </div>

          {trace.error_message && (
            <div className="mt-1 line-clamp-2 text-xs text-destructive">
              {trace.error_message}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

export default function EvalsPage() {
  const [activeView, setActiveView] =
    useState<(typeof VIEW_TABS)[number]["value"]>("overview");
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

  const evaluatorGroups = useMemo(() => {
    const buckets = new Map<string, MetricsResponse["diagnosis"]["evaluatorByEntryPoint"]>();

    for (const row of metrics?.diagnosis.evaluatorByEntryPoint ?? []) {
      const bucket = buckets.get(row.entryPoint) ?? [];
      bucket.push(row);
      buckets.set(row.entryPoint, bucket);
    }

    return [...buckets.entries()];
  }, [metrics?.diagnosis.evaluatorByEntryPoint]);

  useEffect(() => {
    if (
      enabledJudges.length > 0 &&
      !enabledJudges.some((item) => item.name === judgeName)
    ) {
      setJudgeName(enabledJudges[0].name);
    }
  }, [enabledJudges, judgeName]);

  useEffect(() => {
    if (activeView === "review-queue" && reviewState === "all") {
      setReviewState("unreviewed");
    }
  }, [activeView, reviewState]);

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

  function renderWorkbench(showReviewComposer: boolean) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="space-y-4">
            <CardTitle className="text-base">
              {showReviewComposer ? "Review Queue" : "Trace Queue"}
            </CardTitle>

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

          <CardContent>
            <TraceList
              traces={traces}
              isLoading={isLoadingList}
              selectedTraceId={selectedTraceId}
              onSelect={setSelectedTraceId}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          {!selectedTraceId && <EmptyCard title="选择一条 trace 查看详情" />}

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
              {showReviewComposer && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Review Composer</CardTitle>
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
              )}

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

                <CardContent className="grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
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
                  <div>
                    <div className="text-xs text-muted-foreground">Prompt</div>
                    <div>{String(detail.trace.prompt_version || "n/a")}</div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Trace Payload</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
                  <div className="xl:col-span-2">
                    <div className="mb-2 text-xs text-muted-foreground">Metadata</div>
                    <JsonBlock value={detail.trace.metadata} />
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
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <div className="space-y-1">
        <h1 className="text-[30px] font-bold">Evals</h1>
        <p className="text-sm text-muted-foreground">
          按四个视角理解评测系统：全局结果、问题诊断、单条排障、人工复核
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

      <Tabs value={activeView} onValueChange={(value) => setActiveView(String(value) as (typeof VIEW_TABS)[number]["value"])}>
        <TabsList variant="line" className="w-full justify-start">
          {VIEW_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-2 px-3">
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {!metrics && isLoadingMetrics && <EmptyCard title="正在加载 overview..." />}

          {metrics && (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="High-Value Turns"
                  value={
                    isLoadingMetrics
                      ? "..."
                      : `${formatPercent(metrics.summary.hvftrRate)}`
                  }
                  description={`${metrics.summary.hvftrCount} / ${metrics.summary.hvftrEligibleCount} 个价值轮次达标`}
                />
                <MetricCard
                  label="Reuse Rate"
                  value={isLoadingMetrics ? "..." : formatPercent(metrics.flywheel.reuseRate)}
                  description={`${metrics.flywheel.reusedSavedInsightCount} / ${metrics.flywheel.savedInsightCount} 条回流洞察被再次使用`}
                />
                <MetricCard
                  label="Auto Eval Coverage"
                  value={
                    isLoadingMetrics
                      ? "..."
                      : formatPercent(metrics.overview.autoEvalCoverageRate)
                  }
                  description="成功 trace 中，已经产出自动评测结果的覆盖率"
                />
                <MetricCard
                  label="Review Coverage"
                  value={
                    isLoadingMetrics
                      ? "..."
                      : formatPercent(metrics.summary.reviewCoverageRate)
                  }
                  description={`${metrics.summary.pendingReviewCount} 条 trace 尚未人工复核`}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Flywheel Funnel</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                    {metrics.overview.funnel.map((stage) => (
                      <div key={stage.id} className="rounded-lg border p-4">
                        <div className="text-xs text-muted-foreground">{stage.label}</div>
                        <div className="mt-2 text-2xl font-semibold">{stage.count}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          转化率 {formatPercent(stage.rate)}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recent Trend</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <TrendRow
                      label="HVFTR"
                      description="价值链路成功轮次里，高价值通过率"
                      trends={metrics.overview.trends}
                      valueKey="hvftrRate"
                    />
                    <TrendRow
                      label="Auto Eval Coverage"
                      description="成功 trace 中，有自动评测结果的覆盖率"
                      trends={metrics.overview.trends}
                      valueKey="autoEvalCoverageRate"
                    />
                    <TrendRow
                      label="Review Coverage"
                      description="所有 trace 中，已人工复核的覆盖率"
                      trends={metrics.overview.trends}
                      valueKey="reviewCoverageRate"
                    />
                    <TrendRow
                      label="Guardrail Fail"
                      description="成功 trace 中，关键护栏失败率"
                      trends={metrics.overview.trends}
                      valueKey="guardrailFailRate"
                      inverse
                    />
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Entry Point Health</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {metrics.overview.entryPoints.map((item) => (
                    <div key={item.entryPoint} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{item.entryPoint}</div>
                        <Badge variant="outline">
                          {item.successCount}/{item.total}
                        </Badge>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">Success</div>
                          <div>{formatPercent(item.successRate)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Quality</div>
                          <div>{formatPercent(item.qualityRate)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Auto Eval</div>
                          <div>{formatPercent(item.autoEvalCoverageRate)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Judge</div>
                          <div>{formatPercent(item.judgeCoverageRate)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Review</div>
                          <div>{formatPercent(item.reviewCoverageRate)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Latency</div>
                          <div>
                            {item.avgLatencyMs ?? "n/a"} / p95 {item.p95LatencyMs ?? "n/a"} ms
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 text-xs text-muted-foreground">
                        guardrail fail {item.guardrailFailCount} · pending review{" "}
                        {item.pendingReviewCount}
                        {item.hvftrCount > 0 ? ` · HV turns ${item.hvftrCount}` : ""}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="diagnosis" className="space-y-4">
          {!metrics && isLoadingMetrics && <EmptyCard title="正在加载 diagnosis..." />}

          {metrics && (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Guardrail Fail Rate"
                  value={formatPercent(metrics.overview.guardrailFailRate)}
                  description="成功 trace 中，触发关键护栏失败的比例"
                />
                <MetricCard
                  label="Judge Coverage Gap"
                  value={`${metrics.diagnosis.coverage.tracesWithoutJudgeCount}`}
                  description="本应有 judge 的成功 trace 中，尚未跑 judge 的数量"
                />
                <MetricCard
                  label="Auto Eval Gap"
                  value={`${metrics.diagnosis.coverage.tracesWithoutAutoEvalCount}`}
                  description="成功 trace 中，尚未产出任何自动评估结果的数量"
                />
                <MetricCard
                  label="High Priority Pending"
                  value={`${metrics.diagnosis.coverage.highPriorityPendingCount}`}
                  description="未复核且已出现失败信号的 trace 数量"
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Regression Watch</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {metrics.diagnosis.regressions.length === 0 && (
                    <div className="text-sm text-muted-foreground">
                      最近两个窗口没有发现明确回归，或样本不足以做窗口比较。
                    </div>
                  )}
                  {metrics.diagnosis.regressions.map((item) => (
                    <div key={`${item.entryPoint}:${item.metric}`} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">
                            {item.entryPoint} · {item.metricLabel}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            最近 7 天 vs 前 7 天
                          </div>
                        </div>
                        <Badge variant="outline" className="border-red-500/30 text-red-700">
                          {formatDelta(item.delta)}
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">Current</div>
                          <div>{formatPercent(item.currentRate)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Previous</div>
                          <div>{formatPercent(item.previousRate)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Current Samples</div>
                          <div>{item.currentTotal}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Previous Samples</div>
                          <div>{item.previousTotal}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ClipboardList className="h-4 w-4" />
                      Human Failure Hotspots
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {metrics.diagnosis.labelHotspots.length === 0 && (
                      <div className="text-sm text-muted-foreground">
                        还没有形成稳定的人工 failure cluster
                      </div>
                    )}
                    {metrics.diagnosis.labelHotspots.map((item) => (
                      <div key={item.code} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{item.code}</div>
                          <Badge variant="outline">{item.count}</Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.entryPoints.join(" / ") || "n/a"} · 最近一次{" "}
                          {new Date(item.latestCreatedAt).toLocaleString("zh-CN")}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <AlertTriangle className="h-4 w-4" />
                      Automated Failure Hotspots
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {metrics.diagnosis.automatedHotspots.length === 0 && (
                      <div className="text-sm text-muted-foreground">
                        当前没有自动失败热点
                      </div>
                    )}
                    {metrics.diagnosis.automatedHotspots.map((item) => (
                      <div key={item.evaluatorName} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{item.evaluatorName}</div>
                          <Badge variant="outline">{item.count}</Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.evaluatorType} · {item.entryPoints.join(" / ")}
                        </div>
                        {item.exampleTraceIds.length > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            例子:{" "}
                            {item.exampleTraceIds.map((id) => id.slice(0, 8)).join(", ")}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldAlert className="h-4 w-4" />
                    Coverage By Entry Point
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {metrics.diagnosis.coverage.unreviewedByEntryPoint.map((item) => (
                    <div key={item.entryPoint} className="rounded-lg border p-3">
                      <div className="font-medium">{item.entryPoint}</div>
                      <div className="mt-1 text-sm">{item.pendingReviewCount}</div>
                      <div className="text-xs text-muted-foreground">
                        待人工复核
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Evaluator Matrix</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/12 px-2 py-1">
                      pass &gt;= 90%
                    </span>
                    <span className="rounded-full border border-lime-500/30 bg-lime-500/10 px-2 py-1">
                      75% - 89%
                    </span>
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/12 px-2 py-1">
                      60% - 74%
                    </span>
                    <span className="rounded-full border border-red-500/30 bg-red-500/12 px-2 py-1">
                      &lt; 60%
                    </span>
                  </div>
                  {evaluatorGroups.map(([entry, rows]) => (
                    <div key={entry} className="space-y-2">
                      <div className="text-sm font-medium">{entry}</div>
                      <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                        {rows.slice(0, 8).map((row) => (
                          <div
                            key={`${row.entryPoint}:${row.evaluatorName}`}
                            className={`rounded-lg border p-3 ${heatTone(row.passRate)}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium">{row.evaluatorName}</div>
                              <Badge variant="outline">{formatPercent(row.passRate)}</Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {row.evaluatorType} · {row.total} runs · {row.failCount} fails
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="trace-lab" className="space-y-4">
          {renderWorkbench(false)}
        </TabsContent>

        <TabsContent value="review-queue" className="space-y-4">
          {metrics && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <MetricCard
                label="Pending Review"
                value={`${metrics.review.pendingReviewCount}`}
                description="当前整个评测系统里，尚未人工复核的 trace"
              />
              <MetricCard
                label="High Priority Pending"
                value={`${metrics.review.highPriorityPendingCount}`}
                description="已经出现失败信号，应优先审查"
              />
              <MetricCard
                label="Current Queue Mode"
                value={reviewState}
                description="Review Queue 默认建议聚焦 unreviewed"
              />
            </div>
          )}
          {renderWorkbench(true)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
