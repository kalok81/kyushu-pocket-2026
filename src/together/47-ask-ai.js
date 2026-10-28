  // ---- AI 助手: translating a photo and asking about the trip, as receiptJobs answered by the function ----
  // aiJob resolves with the job's result (or rejects with its message); the job is deleted once read.
  const aiWaits = new Map();
  function aiJob(data) {
    if (state.status !== "ready") return Promise.reject(new Error("請先登入，AI 助手只限旅伴使用。"));
    if (!navigator.onLine) return Promise.reject(new Error("離線中，有網絡時再試。"));
    const job = queueJob({ file: "AI 助手", ...data });
    return new Promise((ok, fail) => {
      aiWaits.set(job.id, { ok, fail });
      job.sent.catch(() => {
        aiWaits.delete(job.id);
        fail(new Error("未能送出給 AI，請確認你仍在旅伴名單。"));
      });
    });
  }
  function handleAiJobs() {
    for (const j of jobs.filter((j) => ["translate", "ask", "eventFill"].includes(j.kind) && (j.status === "done" || j.status === "failed"))) {
      const w = aiWaits.get(j.id);
      aiWaits.delete(j.id);
      if (w) j.status === "done" ? w.ok(j.result || {}) : w.fail(new Error(j.error || "AI 未能完成，請再試。"));
      fb.fs.deleteDoc(jobRef(j.id)).catch(() => {});
    }
  }
