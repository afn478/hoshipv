IINATAN.assEscape = function (text) {
  return String(text === undefined ? "" : text)
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
};
IINATAN.assColor = function (rgb, alpha) {
  var value = String(rgb || "ffffff").replace(/^#/, "");
  return (
    "&H" +
    (alpha || "00") +
    value.substring(4, 6) +
    value.substring(2, 4) +
    value.substring(0, 2) +
    "&"
  );
};

class AssBuilder {
  constructor() {
    this.events = [];
    this.clip = null;
  }
  event(layer, tags, text) {
    var clip = this.clip
      ? "\\clip(" +
        Math.round(this.clip.x) +
        "," +
        Math.round(this.clip.y) +
        "," +
        Math.round(this.clip.x + this.clip.w) +
        "," +
        Math.round(this.clip.y + this.clip.h) +
        ")"
      : "";
    this.events.push("{\\layer" + layer + clip + tags + "}" + text);
    return this;
  }
  text(layer, x, y, style, text) {
    var tags =
      "\\an7\\pos(" +
      Math.round(x) +
      "," +
      Math.round(y) +
      ")\\fn" +
      IINATAN.assEscape(style.font || "Noto Sans") +
      "\\fs" +
      style.size +
      "\\c" +
      IINATAN.assColor(style.color) +
      "\\alpha&H00&";
    if (style.bold) tags += "\\b1";
    if (style.italic) tags += "\\i1";
    return this.event(layer, tags, IINATAN.assEscape(text));
  }
  rect(layer, rect, fill, border, radius) {
    var x = rect.x,
      y = rect.y,
      r = Math.max(0, Math.min(radius || 0, rect.w / 2, rect.h / 2));
    var path = r
      ? "m " +
        (x + r) +
        " " +
        y +
        " l " +
        (x + rect.w - r) +
        " " +
        y +
        " b " +
        (x + rect.w) +
        " " +
        y +
        " " +
        (x + rect.w) +
        " " +
        y +
        " " +
        (x + rect.w) +
        " " +
        (y + r) +
        " l " +
        (x + rect.w) +
        " " +
        (y + rect.h - r) +
        " b " +
        (x + rect.w) +
        " " +
        (y + rect.h) +
        " " +
        (x + rect.w) +
        " " +
        (y + rect.h) +
        " " +
        (x + rect.w - r) +
        " " +
        (y + rect.h) +
        " l " +
        (x + r) +
        " " +
        (y + rect.h) +
        " b " +
        x +
        " " +
        (y + rect.h) +
        " " +
        x +
        " " +
        (y + rect.h) +
        " " +
        x +
        " " +
        (y + rect.h - r) +
        " l " +
        x +
        " " +
        (y + r) +
        " b " +
        x +
        " " +
        y +
        " " +
        x +
        " " +
        y +
        " " +
        (x + r) +
        " " +
        y
      : "m " +
        x +
        " " +
        y +
        " l " +
        (x + rect.w) +
        " " +
        y +
        " l " +
        (x + rect.w) +
        " " +
        (y + rect.h) +
        " l " +
        x +
        " " +
        (y + rect.h);
    var tags =
      "\\an7\\pos(0,0)\\p1\\bord" +
      (border ? 1 : 0) +
      "\\shad0\\c" +
      IINATAN.assColor(fill) +
      (border ? "\\3c" + IINATAN.assColor(border) : "");
    return this.event(layer, tags, path + "\\p0");
  }
  build() {
    return this.events.join("\n");
  }
}
IINATAN.AssBuilder = AssBuilder;
IINATAN.intersectRect = function (a, b) {
  if (!a) return b;
  if (!b) return a;
  var x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y),
    right = Math.min(a.x + a.w, b.x + b.w),
    bottom = Math.min(a.y + a.h, b.y + b.h);
  return { x: x, y: y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
};
IINATAN.wrappedText = function (text, metrics) {
  var clusters = (metrics && metrics.clusters) || [];
  if (clusters.length < 2) return text;
  var breaks = [],
    previous = clusters[0];
  for (var index = 1; index < clusters.length; index++) {
    var cluster = clusters[index];
    if (cluster.y > previous.y + previous.height / 2 && cluster.x < previous.x)
      breaks.push(cluster.utf16Range[0]);
    previous = cluster;
  }
  for (var offset = breaks.length - 1; offset >= 0; offset--)
    text =
      text.substring(0, breaks[offset]) + "\n" + text.substring(breaks[offset]);
  return text;
};

class HitRegion {
  constructor(id, rect, handler, cursor, order) {
    this.id = id;
    this.rect = rect;
    this.handler = handler || {};
    this.cursor = cursor || "default";
    this.order = order || 0;
  }
  contains(x, y) {
    return (
      x >= this.rect.x &&
      y >= this.rect.y &&
      x <= this.rect.x + this.rect.w &&
      y <= this.rect.y + this.rect.h
    );
  }
  area() {
    return this.rect.w * this.rect.h;
  }
}
class SpatialIndex {
  constructor(cell) {
    this.cell = cell || 96;
    this.cells = Object.create(null);
  }
  clear() {
    this.cells = Object.create(null);
  }
  add(region) {
    var x0 = Math.floor(region.rect.x / this.cell),
      x1 = Math.floor((region.rect.x + region.rect.w) / this.cell);
    var y0 = Math.floor(region.rect.y / this.cell),
      y1 = Math.floor((region.rect.y + region.rect.h) / this.cell);
    for (var y = y0; y <= y1; y++)
      for (var x = x0; x <= x1; x++) {
        var key = x + ":" + y;
        if (!this.cells[key]) this.cells[key] = [];
        this.cells[key].push(region);
      }
  }
  hit(x, y) {
    var list = (
      this.cells[Math.floor(x / this.cell) + ":" + Math.floor(y / this.cell)] ||
      []
    ).filter(function (region) {
      return region.contains(x, y);
    });
    list.sort(function (a, b) {
      return b.order - a.order || a.area() - b.area();
    });
    return list[0] || null;
  }
}
IINATAN.HitRegion = HitRegion;
IINATAN.SpatialIndex = SpatialIndex;

class Widget {
  constructor(id, props) {
    this.id = id;
    this.props = props || {};
    this.children = [];
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
  }
  add(child) {
    this.children.push(child);
    return this;
  }
  measure(ctx, limits) {
    return { w: 0, h: 0 };
  }
  layout(rect) {
    this.rect = rect;
  }
  render(ctx) {
    this.children.forEach(function (child) {
      child.render(ctx);
    });
  }
  event() {
    return false;
  }
}
class TextRun extends Widget {
  constructor(id, text, style, action) {
    super(id);
    this.text = String(text || "");
    this.style = style || {};
    this.action = action;
    this.metrics = null;
  }
  measure(ctx, limits) {
    this.metrics = ctx.measure(this.text, this.style, limits.w);
    return {
      w: this.metrics.width || 0,
      h: this.metrics.height || (this.style.size || 20) * 1.35,
    };
  }
  render(ctx) {
    if (this.metrics && this.metrics.clusters) {
      var self = this;
      this.metrics.clusters.forEach(function (cluster, index) {
        if (IINATAN.clusterSelected(self.id, index))
          ctx.ass.rect(
            ctx.layer++,
            {
              x: self.rect.x + cluster.x,
              y: self.rect.y + cluster.y,
              w: cluster.width,
              h: cluster.height,
            },
            ctx.theme.accent,
            null,
            2,
          );
      });
    }
    ctx.ass.text(
      ctx.layer++,
      this.rect.x,
      this.rect.y,
      this.style,
      IINATAN.wrappedText(this.text, this.metrics),
    );
    if (this.action)
      ctx.hit(this.id, this.rect, { click: this.action }, "pointer");
    if (this.metrics && this.metrics.clusters)
      ctx.clusters(this, this.metrics.clusters);
  }
}
class Stack extends Widget {
  constructor(id, direction, gap, props) {
    super(id, props);
    this.direction = direction;
    this.gap = gap || 0;
  }
  measure(ctx, limits) {
    var main = 0,
      cross = 0,
      self = this;
    this.sizes = this.children.map(function (child) {
      var size = child.measure(ctx, limits);
      main += self.direction === "h" ? size.w : size.h;
      cross = Math.max(cross, self.direction === "h" ? size.h : size.w);
      return size;
    });
    if (this.sizes.length) main += this.gap * (this.sizes.length - 1);
    return this.direction === "h"
      ? { w: main, h: cross }
      : { w: cross, h: main };
  }
  layout(rect) {
    super.layout(rect);
    var cursor = this.direction === "h" ? rect.x : rect.y,
      self = this;
    this.children.forEach(function (child, index) {
      var size = self.sizes[index];
      var next =
        self.direction === "h"
          ? { x: cursor, y: rect.y, w: size.w, h: rect.h }
          : { x: rect.x, y: cursor, w: rect.w, h: size.h };
      child.layout(next);
      cursor += (self.direction === "h" ? size.w : size.h) + self.gap;
    });
  }
}
class HStack extends Stack {
  constructor(id, gap, props) {
    super(id, "h", gap, props);
  }
}
class VStack extends Stack {
  constructor(id, gap, props) {
    super(id, "v", gap, props);
  }
}
class Button extends Widget {
  constructor(id, label, action, props) {
    super(id, props);
    this.label = label;
    this.action = action;
  }
  measure(ctx) {
    this.metrics = ctx.measure(
      this.label,
      this.props.style || ctx.styles.body,
      0,
    );
    return {
      w: this.metrics.width + 20,
      h: Math.max(28, this.metrics.height + 10),
    };
  }
  render(ctx) {
    ctx.ass.rect(
      ctx.layer++,
      this.rect,
      this.props.fill || ctx.theme.border,
      ctx.theme.border,
      5,
    );
    ctx.ass.text(
      ctx.layer++,
      this.rect.x + 10,
      this.rect.y + 5,
      this.props.style || ctx.styles.body,
      this.label,
    );
    ctx.hit(this.id, this.rect, { click: this.action }, "pointer");
  }
}
class Toggle extends Button {
  constructor(id, label, value, action, props) {
    super(id, (value ? "● " : "○ ") + label, action, props);
    this.value = value;
  }
}
class Chip extends Button {
  measure(ctx) {
    var size = super.measure(ctx);
    return { w: size.w, h: 24 };
  }
}
class Link extends TextRun {
  constructor(id, text, url, style) {
    super(id, text, style, function () {
      IINATAN.openUrl(url);
    });
    this.url = url;
  }
}
class List extends VStack {}
class Scrollbar extends Widget {
  constructor(id, view) {
    super(id);
    this.view = view;
  }
  measure() {
    return { w: 8, h: this.view.rect.h };
  }
  render(ctx) {
    var ratio = Math.min(
      1,
      this.view.rect.h / Math.max(1, this.view.contentHeight),
    );
    var thumb = {
      x: this.rect.x + 2,
      y:
        this.rect.y +
        (this.rect.h - this.rect.h * ratio) * this.view.scrollRatio(),
      w: 4,
      h: Math.max(18, this.rect.h * ratio),
    };
    ctx.ass.rect(ctx.layer++, thumb, ctx.theme.muted, null, 2);
    ctx.hit(
      this.id,
      this.rect,
      { wheel: this.view.onWheel.bind(this.view) },
      "scroll",
    );
  }
}
class ScrollView extends Widget {
  constructor(id, child, props) {
    super(id, props);
    this.child = child;
    this.scrollY = 0;
    this.contentHeight = 0;
    this.scrollbar = new Scrollbar(id + ":bar", this);
  }
  measure(ctx, limits) {
    var size = this.child.measure(ctx, limits);
    this.contentHeight = size.h;
    return {
      w: Math.min(limits.w, size.w + 10),
      h: Math.min(limits.h, size.h),
    };
  }
  layout(rect) {
    super.layout(rect);
    this.scrollY = Math.min(
      this.scrollY,
      Math.max(0, this.contentHeight - rect.h),
    );
    this.child.layout({
      x: rect.x,
      y: rect.y - this.scrollY,
      w: rect.w - 10,
      h: this.contentHeight,
    });
    this.scrollbar.layout({
      x: rect.x + rect.w - 8,
      y: rect.y,
      w: 8,
      h: rect.h,
    });
  }
  render(ctx) {
    ctx.hit(this.id, this.rect, { wheel: this.onWheel.bind(this) }, "scroll");
    ctx.withClip(this.rect, this.child.render.bind(this.child, ctx));
    if (this.contentHeight > this.rect.h) this.scrollbar.render(ctx);
  }
  onWheel(delta) {
    this.scrollY = Math.max(
      0,
      Math.min(
        this.contentHeight - this.rect.h,
        this.scrollY + (delta > 0 ? -44 : 44),
      ),
    );
    IINATAN.invalidateScene("scroll");
  }
  scrollRatio() {
    return this.scrollY / Math.max(1, this.contentHeight - this.rect.h);
  }
}
class Expandable extends Widget {
  constructor(id, title, child, expanded) {
    super(id);
    this.title = title;
    this.child = child;
    this.expanded = !!expanded;
  }
  measure(ctx, limits) {
    this.header = new Button(
      this.id + ":toggle",
      (this.expanded ? "▾ " : "▸ ") + this.title,
      this.toggle.bind(this),
    );
    var hs = this.header.measure(ctx, limits);
    this.childSize = this.expanded
      ? this.child.measure(ctx, limits)
      : { w: 0, h: 0 };
    return { w: Math.max(hs.w, this.childSize.w), h: hs.h + this.childSize.h };
  }
  layout(rect) {
    super.layout(rect);
    this.header.layout({ x: rect.x, y: rect.y, w: rect.w, h: 28 });
    if (this.expanded)
      this.child.layout({
        x: rect.x,
        y: rect.y + 28,
        w: rect.w,
        h: this.childSize.h,
      });
  }
  render(ctx) {
    this.header.render(ctx);
    if (this.expanded) this.child.render(ctx);
  }
  toggle() {
    this.expanded = !this.expanded;
    IINATAN.invalidateScene("expand");
  }
}
class Table extends Widget {
  constructor(id, rows, props) {
    super(id, props);
    this.rows = rows || [];
  }
  measure(ctx, limits) {
    var self = this;
    this.cells = this.rows.map(function (row, ri) {
      return row.map(function (cell, ci) {
        var run =
          cell instanceof Widget
            ? cell
            : new TextRun(self.id + ":" + ri + ":" + ci, cell, ctx.styles.body);
        return { run: run, size: run.measure(ctx, limits) };
      });
    });
    this.cols = [];
    this.cells.forEach(function (row) {
      row.forEach(function (cell, i) {
        self.cols[i] = Math.max(self.cols[i] || 0, cell.size.w + 14);
      });
    });
    return {
      w: Math.min(
        limits.w,
        this.cols.reduce(function (a, b) {
          return a + b;
        }, 0),
      ),
      h: this.cells.length * 30,
    };
  }
  layout(rect) {
    super.layout(rect);
    var self = this;
    this.cells.forEach(function (row, ri) {
      var x = rect.x;
      row.forEach(function (cell, ci) {
        cell.run.layout({
          x: x + 6,
          y: rect.y + ri * 30 + 5,
          w: self.cols[ci] - 12,
          h: 24,
        });
        x += self.cols[ci];
      });
    });
  }
  render(ctx) {
    var self = this;
    this.cells.forEach(function (row, ri) {
      row.forEach(function (cell) {
        cell.run.render(ctx);
      });
      if (ri < self.cells.length - 1)
        ctx.ass.rect(
          ctx.layer++,
          {
            x: self.rect.x,
            y: self.rect.y + (ri + 1) * 30,
            w: self.rect.w,
            h: 1,
          },
          ctx.theme.border,
        );
    });
  }
}
class Callout extends Widget {
  constructor(id, child, props) {
    super(id, props);
    this.child = child;
  }
  measure(ctx, limits) {
    var size = this.child.measure(ctx, { w: limits.w - 20, h: limits.h });
    return { w: size.w + 20, h: size.h + 16 };
  }
  layout(rect) {
    super.layout(rect);
    this.child.layout({
      x: rect.x + 10,
      y: rect.y + 8,
      w: rect.w - 20,
      h: rect.h - 16,
    });
  }
  render(ctx) {
    ctx.ass.rect(
      ctx.layer++,
      this.rect,
      this.props.fill || "242731",
      ctx.theme.border,
      5,
    );
    this.child.render(ctx);
  }
}
class PopupSurface extends Callout {}
class Modal extends PopupSurface {
  measure(ctx, limits) {
    var size = super.measure(ctx, limits);
    return { w: limits.w, h: size.h };
  }
}

IINATAN.Widget = Widget;
IINATAN.TextRun = TextRun;
IINATAN.HStack = HStack;
IINATAN.VStack = VStack;
IINATAN.Button = Button;
IINATAN.Toggle = Toggle;
IINATAN.Chip = Chip;
IINATAN.Link = Link;
IINATAN.List = List;
IINATAN.ScrollView = ScrollView;
IINATAN.Scrollbar = Scrollbar;
IINATAN.Expandable = Expandable;
IINATAN.Table = Table;
IINATAN.Callout = Callout;
IINATAN.Modal = Modal;
IINATAN.PopupSurface = PopupSurface;

class Scene {
  constructor(overlay) {
    this.overlay = overlay;
    this.root = null;
    this.index = new SpatialIndex();
    this.measureCache = Object.create(null);
    this.measureOrder = [];
    this.pendingMetrics = Object.create(null);
    this.clusterRegions = [];
    this.lastData = "";
  }
  context() {
    var self = this,
      profile = IINATAN.config.profiles[IINATAN.config.activeProfileId],
      theme = profile.theme;
    return {
      ass: new AssBuilder(),
      layer: 10,
      theme: theme,
      styles: {
        body: {
          font: "Noto Sans",
          size: 20 * profile.popupScale,
          color: theme.foreground,
        },
        headword: {
          font: "Noto Sans CJK JP",
          size: 30 * profile.popupScale,
          bold: true,
          color: theme.foreground,
        },
        reading: {
          font: "Noto Sans CJK JP",
          size: 18 * profile.popupScale,
          color: theme.muted,
        },
        tag: {
          font: "Noto Sans",
          size: 14 * profile.popupScale,
          color: theme.foreground,
        },
      },
      measure: function (text, style, wrap) {
        return self.measure(text, style, wrap);
      },
      hit: function (id, rect, handler, cursor) {
        var clipped = IINATAN.intersectRect(rect, this.clipRect);
        if (clipped.w > 0 && clipped.h > 0)
          self.index.add(
            new HitRegion(id, clipped, handler, cursor, this.layer),
          );
      },
      clusters: function (widget, clusters) {
        self.addClusters(widget, clusters, this.clipRect);
      },
      clipRect: null,
      withClip: function (rect, callback) {
        var oldContextClip = this.clipRect,
          oldAssClip = this.ass.clip;
        this.clipRect = IINATAN.intersectRect(oldContextClip, rect);
        this.ass.clip = this.clipRect;
        callback();
        this.clipRect = oldContextClip;
        this.ass.clip = oldAssClip;
      },
    };
  }
  measure(text, style, wrap) {
    var osd = IINATAN.state.osd || {},
      key = JSON.stringify([
        text,
        style.font,
        style.size,
        !!style.bold,
        !!style.italic,
        style.spacing || 0,
        wrap || 0,
        osd.w || 0,
        osd.h || 0,
        IINATAN.platform || "unknown",
      ]);
    if (this.measureCache[key]) return this.measureCache[key];
    if (!this.pendingMetrics[key]) {
      this.pendingMetrics[key] = true;
      var self = this;
      IINATAN.workerRequest(
        {
          type: "text-layout",
          protocol: 1,
          text: text,
          font: {
            family: style.font,
            size: style.size,
            weight: style.bold ? 700 : 400,
            italic: !!style.italic,
            spacing: style.spacing || 0,
          },
          wrapWidth: wrap || 0,
          osdScale: 1,
          fallbackFontPath: IINATAN.fallbackFontPath(),
        },
        function (error, response) {
          delete self.pendingMetrics[key];
          if (!error && response && response.ok) {
            IINATAN.boundedPut(
              self.measureCache,
              self.measureOrder,
              key,
              response,
              512,
            );
            IINATAN.invalidateScene("measurement");
          }
        },
        10000,
      );
    }
    return { width: 0, height: (style.size || 20) * 1.35, clusters: [] };
  }
  addClusters(widget, clusters, clip) {
    var self = this;
    clusters.forEach(function (cluster, index) {
      var rect = {
        x: widget.rect.x + cluster.x,
        y: widget.rect.y + cluster.y,
        w: cluster.width,
        h: cluster.height,
      };
      rect = IINATAN.intersectRect(rect, clip);
      if (rect.w <= 0 || rect.h <= 0) return;
      self.clusterRegions.push({
        widgetId: widget.id,
        index: index,
        rect: rect,
        range: cluster.utf16Range,
        text: widget.text,
      });
    });
  }
  clusterAt(x, y) {
    var matches = this.clusterRegions.filter(function (cluster) {
      var rect = cluster.rect;
      return (
        x >= rect.x &&
        y >= rect.y &&
        x <= rect.x + rect.w &&
        y <= rect.y + rect.h
      );
    });
    return matches.length ? matches[matches.length - 1] : null;
  }
  render(root, rect) {
    this.root = root;
    this.index.clear();
    this.clusterRegions = [];
    var ctx = this.context(),
      size = root.measure(ctx, { w: rect.w, h: rect.h });
    root.layout({
      x: rect.x,
      y: rect.y,
      w: Math.min(rect.w, size.w),
      h: Math.min(rect.h, size.h),
    });
    root.render(ctx);
    var data = ctx.ass.build();
    if (data !== this.lastData) {
      this.overlay.res_x = IINATAN.state.osd.w || 1280;
      this.overlay.res_y = IINATAN.state.osd.h || 720;
      this.overlay.data = data;
      this.overlay.update();
      this.lastData = data;
    }
  }
  clear() {
    if (this.lastData) this.overlay.remove();
    this.lastData = "";
    this.index.clear();
  }
}
IINATAN.Scene = Scene;
