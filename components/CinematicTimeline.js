"use client";

const statusStyles = {
  success: "bg-emerald-400 shadow-[0_0_0_6px_rgba(16,185,129,0.18)]",
  error: "bg-rose-400 shadow-[0_0_0_6px_rgba(248,113,113,0.2)]",
  pending: "bg-amber-300 shadow-[0_0_0_6px_rgba(252,211,77,0.2)] animate-pulse",
  idle: "bg-white/40 shadow-[0_0_0_6px_rgba(255,255,255,0.12)]",
};

const statusText = {
  success: "done",
  error: "error",
  pending: "in flight",
  idle: "queued",
};

const textColor = {
  success: "text-emerald-200",
  error: "text-rose-200",
  pending: "text-amber-200",
  idle: "text-white/60",
};

const CinematicTimeline = ({ title = "Pipeline", steps = [] }) => {
  const orderedSteps = Array.isArray(steps) ? steps : [];
  const currentStep =
    orderedSteps.find((step) => step.status === "pending") ||
    orderedSteps.find((step) => step.status === "error") ||
    orderedSteps.find((step) => step.status === "idle") ||
    orderedSteps[orderedSteps.length - 1];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-lg">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/60">Pipeline</p>
          <h3 className="text-lg font-semibold leading-tight">{title}</h3>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.25em] text-white/60">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
          Live
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {currentStep ? (
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <p className="text-xs uppercase tracking-[0.3em] text-white/60">Now running</p>
            <div className="mt-2 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-2xl font-semibold">
                <span className={`h-3 w-3 rounded-full ${statusStyles[currentStep.status] || statusStyles.idle}`} />
                <span>{currentStep.label}</span>
              </div>
              <p className="text-sm text-white/70">{currentStep.message || statusText[currentStep.status] || "Queued"}</p>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-3 text-xs text-white/60">
          {orderedSteps.map((step, idx) => {
            const status = step.status || "idle";
            const isLast = idx === orderedSteps.length - 1;
            return (
              <div key={step.key || idx} className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-3 w-3 rounded-full ${statusStyles[status] || statusStyles.idle}`} />
                  <span className="truncate">{step.label}</span>
                </div>
                {!isLast && <div className="h-px flex-1 bg-white/10" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CinematicTimeline;
