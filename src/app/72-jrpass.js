  // ---- JR Pass: every JR train in the main 方案 of each day, read from the stops' 交通 (so it follows the plan) ----
  // A ride in 交通 is written "🚆 特急ソニック 11 號 博多 → 小倉（09:21–10:10，3番線）": the line, the station before the
  // arrow, the one after it, then times, platform and seat notes in brackets.
  const RIDE = /(?:🚆|🚄|🚃|🚝|🚉)\s*([^→]+?)\s+(\S+)\s*→\s*([^（→｜]+?)\s*（([^）]*)）/g;
  const JR_LINE = /JR|新幹線|ソニック|かもめ|ゆふ|みどり|ハウステンボス|きらめき|にちりん|有明|かいおう|あそ|或る列車|指宿|はやと|海幸山幸|ひゅうが|きりしま|みずほ|さくら|つばめ|のぞみ|ひかり|こだま|區間快速|区間快速|本線|筑肥線|香椎線|篠栗線|唐津線|大村線|佐世保線/;
  const NOT_JR = /地下鉄|西鉄|バス|巴士|汽船|モノレール|筑豊電|私鉄|ゆいレール/;
  // JR Kyushu passes leave out the San'yo Shinkansen (Hakata–Kokura and beyond is JR West)
  const SANYO = (r) => /新幹線|のぞみ|ひかり|こだま|みずほ|さくら/.test(r.line) && /小倉|新下関|広島|岡山|新大阪/.test(r.from + r.to) && !/熊本|鹿児島|久留米|新鳥栖|筑後/.test(r.from + r.to);
  function jrRides(text) {
    const out = [],
      remark = /｜[^（]*（([^）]*)）\s*$/.exec(text)?.[1] || "";
    for (const m of String(text || "").matchAll(RIDE)) {
      const line = m[1].replace(/^JR\s*/, "JR ").trim(),
        bits = m[4].split(/[，,]/).map((b) => b.trim()).filter(Boolean),
        t = /(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/.exec(m[4]);
      if (!JR_LINE.test(line) || NOT_JR.test(line.replace(/（[^）]*）/g, ""))) continue;
      out.push({
        line,
        from: m[2].trim(),
        to: m[3].trim(),
        depart: t?.[1] || "",
        arrive: t?.[2] || "",
        platform: bits.find((b) => /番線|のりば|月台/.test(b)) || "",
        notes: bits.filter((b) => !/\d{1,2}:\d{2}|番線|のりば|月台|^\d+ 站$/.test(b) && !/^JR Pass$/i.test(b)),
      });
    }
    const extra = remark.split(/[，,]/).map((b) => b.trim()).filter((b) => b && !/^JR Pass$|估算|乗換案内|NAVITIME|截圖/i.test(b));
    if (out.length && extra.length) out.at(-1).notes.push(extra.join("，"));
    return out.map((r) => ({ ...r, sanyo: SANYO(r) }));
  }
  function renderJrPass() {
    const all = days.map((d) => ({ d, rides: stopsFor(d.n).flatMap((s) => jrRides(s.transport)) })).filter((x) => x.rides.length),
      count = all.reduce((n, x) => n + x.rides.length, 0);
    const row = (r) =>
      `<tr${r.sanyo ? ' class="jr-out"' : ""}><td><b>${esc(r.line)}</b>${r.platform ? `<small>${esc(r.platform)}</small>` : ""}${r.notes.map((n) => `<small>${esc(n)}</small>`).join("")}${r.sanyo ? "<small class=\"jr-warn\">JR Pass 不包（山陽新幹線）</small>" : ""}</td><td><time>${esc(r.depart || "—")}</time>${esc(r.from)}</td><td><time>${esc(r.arrive || "—")}</time>${esc(r.to)}</td></tr>`;
    const day = ({ d, rides }) =>
      `<tbody><tr class="jr-day"><th colspan="3" scope="rowgroup"><a href="#plan?day=${d.n}">D${d.n} ${esc(d.md)} ${esc(d.weekday)}</a>${variantsOf(d.n).length ? `<small>${esc(mainName(d.n))}</small>` : ""}</th></tr>${rides.map(row).join("")}</tbody>`;
    return `${header("JR Pass", count ? `行程中 ${count} 程 JR` : "行程中的 JR 車程")}${
      all.length
        ? `<div class="jr-wrap"><table class="jr-table"><thead><tr><th scope="col">列車</th><th scope="col">出發</th><th scope="col">到達</th></tr></thead>${all.map(day).join("")}</table></div>`
        : Kit.empty("行程中還沒有 JR", "在行程的交通填上火車（例如「查路線」選用 JR 班次），這裏就會列出。")
    }<p class="note">按每天的主要方案列出，行程或交通改了這裏會跟着更新；按日期可打開那天的行程。JR Pass 能否使用及指定席以 JR 公佈為準。</p>`;
  }
