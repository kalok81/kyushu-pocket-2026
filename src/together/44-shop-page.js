  // ---- 購物: the page (list and grid) and duplicate names ----
  function shopPage() {
    if (state.status !== "ready") return { sig: "wait", shell: Kit.empty("正在連接…") };
    const todo = state.shopping.filter((x) => !x.bought),
      q = norm(state.shopSearch),
      match = (x) => !q || norm([x.name, zhName(x, x.name), x.qty, x.forWhom, x.detail, x.place].join(" ")).includes(q);
    const byStatus = (
        state.shopFilter === "todo" ? todo : state.shopFilter === "done" ? state.shopping.filter((x) => x.bought) : state.shopping
      ).filter(match),
      shown = state.shopCat === "all" ? byStatus : byStatus.filter((x) => shopCat(x) === state.shopCat);
    const count = (k) => byStatus.filter((x) => shopCat(x) === k).length,
      cats = [["all", "全部分類", byStatus.length], ...Object.entries(SHOP_CATS).map(([k, v]) => [k, v, count(k)]).filter(([k, , n]) => n || state.shopCat === k)]
        .map(([k, t, n]) => ({ label: `${t} ${n}`, active: state.shopCat === k, attrs: { "data-shop-cat": k } }));
    const filters = [
      ["todo", "未買", todo.length],
      ["done", "已買", state.shopping.length - todo.length],
      ["all", "全部", state.shopping.length],
    ].map(([k, t, n]) => ({ label: `${t} ${n}`, active: state.shopFilter === k, attrs: { "data-shop-filter": k } }));
    const sorted = [...shown].sort((a, b) => a.bought - b.bought || (b.at || 0) - (a.at || 0)),
      block = (xs) => (state.shopView === "grid" ? `<div class="shop-grid">${xs.map(shopTile).join("")}</div>` : xs.map(shopItem).join(""));
    // All categories: one heading per category, in the order of SHOP_CATS.
    const list = shown.length
      ? state.shopCat === "all"
        ? Object.keys(SHOP_CATS)
            .map((k) => [k, sorted.filter((x) => shopCat(x) === k)])
            .filter(([, xs]) => xs.length)
            .map(([k, xs]) => `<h3 class="shop-cat-head">${SHOP_CATS[k]} <small>${xs.length}</small></h3>${block(xs)}`)
            .join("")
        : block(sorted)
      : q
        ? Kit.empty(`找不到「${esc(state.shopSearch)}」`, "試試其他字，或清除搜尋。")
        : state.shopFilter === "done"
          ? Kit.empty("還沒有已買的東西", "買了之後按「已買」。")
          : Kit.empty("清單是空的", "按右下角「＋物品」，影相讓 AI 認物品，或自己輸入。");
    return {
      sig: ["shop", state.shopView, state.user.uid].join("|"),
      shell: `<div data-tg-live="status"></div><div data-tg-live="jobs"></div><div class="searchrow shop-tools"><input id="shopSearch" class="search" type="search" placeholder="搜尋，或貼上產品網址" aria-label="搜尋購物" value="${esc(state.shopSearch)}">${Kit.chips(
        [
          { label: '<span class="sr-only">列表</span>', icon: "list", active: state.shopView === "list", attrs: { "data-shop-view": "list", title: "列表" } },
          { label: '<span class="sr-only">相片</span>', icon: "grid", active: state.shopView === "grid", attrs: { "data-shop-view": "grid", title: "相片" } },
        ],
        { cls: "view-toggle", label: "顯示方式" },
      )}</div><div data-tg-live="filters"></div><div data-tg-live="cats"></div><div class="tg-list" data-tg-live="list"></div>${Kit.fab("物品", { "data-tg": "shopAdd", "aria-label": "加入物品" })}`,
      live: {
        status: statusBar(),
        jobs: productJobsHtml(),
        filters: Kit.chips(filters, { cls: "tabs", label: "篩選" }),
        cats: Kit.chips(cats, { cls: "shop-cats", label: "分類" }),
        list,
      },
    };
  }
  // An item already on the list: the same name or Chinese name, or one name inside the other (4+ characters), compared
  // without brackets, spaces and punctuation.
  function shopDuplicate(name, except) {
    const bare = (t) => norm(String(t || "").replace(/[（(][^）)]*[)）]/g, "")),
      n = bare(name),
      whole = norm(name);
    if (n.length < 2) return null;
    return state.shopping.find((x) => {
      if (x.id === except) return false;
      const m = bare(x.name),
        all = norm(x.name),
        z = bare(x.zh);
      return m === n || z === n || whole === all || (Math.min(n.length, m.length) >= 4 && (all.includes(n) || whole.includes(m)));
    });
  }
