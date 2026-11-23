/* =========================================================================
 * 地图通 · 简体中文地图软件
 * 底图：高德地图瓦片（GCJ-02 坐标系）
 * 说明：高德瓦片采用 GCJ-02（火星坐标系），因此所有从其它来源
 *       （搜索接口、浏览器定位）得到的 WGS-84 坐标都会先转换为 GCJ-02，
 *       再在地图上绘制，避免出现几百米的偏移。
 * ========================================================================= */
(function () {
  'use strict';

  // 当前区域限定为「上海市」（GCJ-02 坐标）
  var DEFAULT_CENTER = [31.2304, 121.4737]; // 人民广场
  var DEFAULT_ZOOM = 11;
  // 上海市范围（含崇明），用于限制地图可拖动区域
  var SHANGHAI_BOUNDS = L.latLngBounds(
    [30.50, 120.70], // 西南角
    [32.00, 122.30]  // 东北角
  );

  /* ---------------------- 坐标系转换（WGS-84 <-> GCJ-02） ---------------------- */
  var PI = Math.PI;
  var A = 6378245.0;          // 长半轴
  var EE = 0.00669342162296594323; // 偏心率平方

  function outOfChina(lng, lat) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }
  function transformLat(x, y) {
    var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return ret;
  }
  function transformLng(x, y) {
    var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return ret;
  }
  // WGS-84 -> GCJ-02
  function wgs84ToGcj02(lng, lat) {
    if (outOfChina(lng, lat)) return [lng, lat];
    var dLat = transformLat(lng - 105.0, lat - 35.0);
    var dLng = transformLng(lng - 105.0, lat - 35.0);
    var radLat = lat / 180.0 * PI;
    var magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    var sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
    dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
    return [lng + dLng, lat + dLat];
  }
  // GCJ-02 -> WGS-84
  function gcj02ToWgs84(lng, lat) {
    if (outOfChina(lng, lat)) return [lng, lat];
    var g = wgs84ToGcj02(lng, lat);
    return [lng * 2 - g[0], lat * 2 - g[1]];
  }

  function fmt(n, d) { return Number(n).toFixed(d === undefined ? 6 : d); }

  /* ---------------------------- 底图定义 ---------------------------- */
  var AMAP_SUBDOMAINS = ['1', '2', '3', '4'];
  var BASE_LAYERS = {
    vector: {
      url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      options: { subdomains: AMAP_SUBDOMAINS, maxZoom: 18 },
      dark: false
    },
    satellite: {
      url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
      options: { subdomains: AMAP_SUBDOMAINS, maxZoom: 18 },
      dark: false
    },
    satelliteLabel: {
      url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}',
      options: { subdomains: AMAP_SUBDOMAINS, maxZoom: 18 },
      dark: false
    },
    dark: {
      url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      options: { subdomains: AMAP_SUBDOMAINS, maxZoom: 18 },
      dark: true
    }
  };

  /* ---------------------------- 地图初始化 ---------------------------- */
  var map = L.map('map', {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: false,
    attributionControl: false,
    minZoom: 9,
    maxZoom: 18,
    maxBounds: SHANGHAI_BOUNDS,
    maxBoundsViscosity: 1.0,
    // 鼠标滚轮放大地图
    scrollWheelZoom: true,
    // 关闭瓦片淡入动画，避免拖动/缩放时出现半透明"虚影"
    fadeAnimation: false
  });

  L.control.zoom({ position: 'topright' }).addTo(map);

  var currentLayer = null;
  var currentKey = null;

  function setBasemap(key) {
    var def = BASE_LAYERS[key];
    if (!def) return;
    if (currentLayer) map.removeLayer(currentLayer);
    currentLayer = L.tileLayer(def.url, def.options);
    currentLayer.addTo(map);
    currentLayer.on('load', function () {
      // 仅在成功加载后应用深色滤镜
      var pane = map.getPane('tilePane');
      pane.style.filter = def.dark
        ? 'invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9)'
        : 'none';
    });
    // 若瓦片加载失败，恢复默认亮度
    var pane = map.getPane('tilePane');
    pane.style.filter = def.dark
      ? 'invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9)'
      : 'none';
    currentKey = key;
  }
  setBasemap('vector');

  /* ---------------------------- 通用工具 ---------------------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------------------- 地图交互 ---------------------------- */
  var measureMode = false;

  map.on('click', function (e) {
    // 单击仅用于测距取点，不再添加标记
    if (measureMode) addMeasurePoint(e.latlng);
  });

  // 屏蔽浏览器右键菜单：右键 / 长按不触发任何动作
  map.getContainer().addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  map.on('mousemove', function (e) {
    updateCoordsBar(e.latlng);
  });

  map.on('zoomend', updateZoomText);
  map.on('move', function () { updateZoomText(); });

  var coordsTextEl = document.getElementById('coordsText');
  var zoomTextEl = document.getElementById('zoomText');

  function updateCoordsBar(latlng) {
    coordsTextEl.textContent = '经度 ' + fmt(latlng.lng) + ' , 纬度 ' + fmt(latlng.lat);
  }
  function updateZoomText() {
    zoomTextEl.textContent = '缩放 ' + map.getZoom() + ' 级';
  }
  updateZoomText();

  /* ---------------------------- 测距工具 ---------------------------- */
  var measurePoints = [];
  var measureLine = null;
  var measureLayer = L.layerGroup().addTo(map);
  var measurePointsLayer = L.layerGroup().addTo(map);
  var measureTipEl = document.getElementById('measureTip');
  var measureBtn = document.getElementById('measureBtn');

  function addMeasurePoint(latlng) {
    measurePoints.push(latlng);
    L.circleMarker(latlng, {
      radius: 4, color: '#fff', weight: 2, fillColor: '#e34d59', fillOpacity: 1
    }).addTo(measurePointsLayer);

    if (measureLine) measureLayer.removeLayer(measureLine);
    measureLine = L.polyline(measurePoints, { color: '#e34d59', weight: 3, dashArray: '6 6' });
    measureLine.addTo(measureLayer);
    updateMeasureTip();
  }

  function totalDistance(points) {
    var d = 0;
    for (var i = 1; i < points.length; i++) d += map.distance(points[i - 1], points[i]);
    return d;
  }
  function formatDistance(m) {
    return m >= 1000 ? (m / 1000).toFixed(2) + ' 公里' : Math.round(m) + ' 米';
  }
  function updateMeasureTip() {
    var n = measurePoints.length;
    if (n === 0) {
      measureTipEl.textContent = '测距中：单击地图添加起点，双击结束。';
    } else if (n === 1) {
      measureTipEl.textContent = '测距中：已添加起点，继续单击添加节点。';
    } else {
      measureTipEl.textContent = '测距中：共 ' + n + ' 个节点，总距离 ' + formatDistance(totalDistance(measurePoints)) + '（双击结束）';
    }
  }

  function clearMeasure() {
    measurePoints = [];
    if (measureLine) { measureLayer.removeLayer(measureLine); measureLine = null; }
    measurePointsLayer.clearLayers();
  }

  function stopMeasure() {
    measureMode = false;
    measureBtn.classList.remove('active');
    measureTipEl.hidden = true;
    clearMeasure();
  }

  measureBtn.addEventListener('click', function () {
    if (measureMode) { stopMeasure(); return; }
    measureMode = true;
    measureBtn.classList.add('active');
    measureTipEl.hidden = false;
    clearMeasure();
    updateMeasureTip();
  });

  map.on('dblclick', function () {
    if (measureMode && measurePoints.length >= 2) {
      var d = formatDistance(totalDistance(measurePoints));
      alert('测距结果：总距离 ' + d + '（共 ' + measurePoints.length + ' 个节点）');
      stopMeasure();
    }
  });
  // 双击缩放会与测距冲突，测距时禁用
  map.on('dblclick', function (e) {
    if (measureMode) L.DomEvent.stop(e);
  });

  /* ---------------------------- 定位 ---------------------------- */
  var locateBtn = document.getElementById('locateBtn');
  var locateMarker = null;

  locateBtn.addEventListener('click', function () {
    if (!navigator.geolocation) {
      alert('当前浏览器不支持定位功能。');
      return;
    }
    locateBtn.textContent = '定位中…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      locateBtn.innerHTML = '<span class="ico">◎</span>定位';
      // 浏览器返回 WGS-84，转换为 GCJ-02 以匹配底图
      var gcj = wgs84ToGcj02(pos.coords.longitude, pos.coords.latitude);
      var latlng = L.latLng(gcj[1], gcj[0]);

      if (locateMarker) map.removeLayer(locateMarker);
      locateMarker = L.circleMarker(latlng, {
        radius: 8, color: '#fff', weight: 3, fillColor: '#2b7de9', fillOpacity: 1
      }).addTo(map);
      locateMarker.bindPopup('<b>我的位置</b><br><span class="popup-coord">经度 ' + fmt(gcj[0]) +
        '<br>纬度 ' + fmt(gcj[1]) + '</span>').openPopup();

      map.setView(latlng, 16);
    }, function (err) {
      locateBtn.innerHTML = '<span class="ico">◎</span>定位';
      var msg = '定位失败：';
      if (err.code === 1) msg += '已拒绝定位权限。';
      else if (err.code === 2) msg += '无法获取位置信息。';
      else if (err.code === 3) msg += '定位超时。';
      else msg += err.message || '未知错误。';
      alert(msg);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });

  /* ---------------------------- 搜索 ---------------------------- */
  var searchInput = document.getElementById('searchInput');
  var searchBtn = document.getElementById('searchBtn');
  var searchResultsEl = document.getElementById('searchResults');
  var searchMarker = null;

  function showResults(html) {
    searchResultsEl.innerHTML = html;
    searchResultsEl.hidden = false;
  }
  function hideResults() { searchResultsEl.hidden = true; searchResultsEl.innerHTML = ''; }

  function parseCoordQuery(q) {
    var m = q.replace(/[，,]/g, ' ').match(/^\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    var a = parseFloat(m[1]), b = parseFloat(m[2]);
    // 判断哪一个是纬度：|a|<=90 视为纬度
    var lat, lng;
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) { lat = a; lng = b; }
    else { lat = b; lng = a; }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return [lng, lat];
  }

  function doSearch() {
    var q = searchInput.value.trim();
    if (!q) { hideResults(); return; }

    // 支持直接输入坐标
    var coord = parseCoordQuery(q);
    if (coord) {
      hideResults();
      gotoLocation(coord[0], coord[1], q + '（坐标）', true);
      return;
    }

    searchBtn.disabled = true;
    searchBtn.textContent = '搜索中';
    showResults('<li class="search-empty">正在搜索…</li>');

    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=6' +
      '&accept-language=zh-CN' +
      '&bounded=1&viewbox=120.70,32.00,122.30,30.50' +
      '&q=' + encodeURIComponent(q);

    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (list) {
        if (!list || !list.length) {
          showResults('<li class="search-empty">未找到匹配地点，可尝试更完整的地名，或直接输入经纬度（如 39.9087,116.3975）。</li>');
          return;
        }
        searchResultsEl.innerHTML = '';
        list.forEach(function (item) {
          var li = document.createElement('li');
          var name = item.display_name || '未命名地点';
          var shortName = name.split(',')[0];
          li.innerHTML = '<span>' + escapeHtml(shortName) + '</span><small>' + escapeHtml(name) + '</small>';
          li.addEventListener('click', function () {
            hideResults();
            gotoLocation(parseFloat(item.lon), parseFloat(item.lat), shortName, true);
          });
          searchResultsEl.appendChild(li);
        });
        searchResultsEl.hidden = false;
      })
      .catch(function () {
        showResults('<li class="search-empty">搜索服务连接失败，请检查网络；也可直接输入经纬度（如 39.9087,116.3975）。</li>');
      })
      .finally(function () {
        searchBtn.disabled = false;
        searchBtn.textContent = '搜索';
      });
  }

  // 前往某点：输入为 WGS-84，自动转 GCJ-02
  function gotoLocation(lng, lat, name, fromWgs84) {
    var gcj = fromWgs84 ? wgs84ToGcj02(lng, lat) : [lng, lat];
    var latlng = L.latLng(gcj[1], gcj[0]);
    map.setView(latlng, 15);
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'search-marker',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:#e34d59;border:3px solid #fff;box-shadow:0 0 0 1px #e34d59;"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })
    }).addTo(map);
    searchMarker.bindPopup('<b>' + escapeHtml(name) + '</b>').openPopup();
  }

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doSearch();
  });

  /* ---------------------------- 图层切换绑定 ---------------------------- */
  var layerListEl = document.getElementById('layerList');
  layerListEl.addEventListener('change', function (e) {
    if (e.target.name === 'basemap') setBasemap(e.target.value);
  });

  /* ---------------------------- 全屏 / 收起 ---------------------------- */
  var mapWrap = document.getElementById('mapWrap');
  document.getElementById('fullscreenBtn').addEventListener('click', function () {
    if (!document.fullscreenElement) {
      (mapWrap.requestFullscreen || mapWrap.webkitRequestFullscreen || function () {}).call(mapWrap);
    } else {
      document.exitFullscreen();
    }
  });
  document.addEventListener('fullscreenchange', function () {
    setTimeout(function () { map.invalidateSize(); }, 200);
  });

  var sidebar = document.getElementById('sidebar');
  var collapseBtn = document.getElementById('collapseBtn');
  var expandBtn = null;

  function toggleSidebar(collapsed) {
    sidebar.classList.toggle('collapsed', collapsed);
    if (collapsed) {
      if (!expandBtn) {
        expandBtn = document.createElement('button');
        expandBtn.className = 'expand-btn';
        expandBtn.title = '展开面板';
        expandBtn.textContent = '☰';
        expandBtn.addEventListener('click', function () { toggleSidebar(false); });
        mapWrap.appendChild(expandBtn);
      }
      expandBtn.style.display = 'block';
    } else if (expandBtn) {
      expandBtn.style.display = 'none';
    }
    setTimeout(function () { map.invalidateSize(); }, 260);
  }
  collapseBtn.addEventListener('click', function () { toggleSidebar(true); });

  /* ---------------------------- 上海 12 月活动标注 ---------------------------- */
  var EVENT_DATA = (window.SH_EVENTS && window.SH_EVENTS.events) || [];
  var SOURCE_TYPES = ['豆瓣', '格瓦拉', '携程', '凤凰网'];
  var activeSources = {};
  SOURCE_TYPES.forEach(function (s) { activeSources[s] = true; });

  var eventLayer = L.layerGroup().addTo(map);
  var eventListEl = document.getElementById('eventList');
  var eventFilterEl = document.getElementById('eventFilter');
  var eventCountEl = document.getElementById('eventCount');
  var markerByKey = {};
  // 是否在地图上常显活动标注文字
  var labelsOn = true;
  // 低于该缩放级别只显示标记点，避免标注文字互相重叠
  var LABEL_MIN_ZOOM = 14;
  var lastLabelState = null;
  var labelTipEl = document.getElementById('labelTip');

  function labelsVisible() {
    return labelsOn && map.getZoom() >= LABEL_MIN_ZOOM;
  }

  function updateLabelTip() {
    labelTipEl.hidden = !(labelsOn && map.getZoom() < LABEL_MIN_ZOOM);
  }

  function locKey(ev) { return ev.lat.toFixed(4) + ',' + ev.lng.toFixed(4); }

  // 列表点击后待打开的弹窗：若触发缩放重绘，等新标记生成后再打开
  var pendingOpenKey = null;
  function openPendingPopup() {
    if (!pendingOpenKey) return;
    var m = markerByKey[pendingOpenKey];
    if (m) { m.openPopup(); pendingOpenKey = null; }
  }

  /* 去掉「上海 / ××区」等冗余前缀，得到可读的地点名 */
  function placeLabel(items) {
    var p = String(items[0].place || '').trim();
    p = p.replace(/^上海\s*/, '').replace(/^[^\s]+区\s*/, '');
    return p || '未标注地点';
  }

  /* 同一坐标（同一场馆）的活动合并为一个标注 */
  function groupByLocation(list) {
    var groups = [];
    var index = {};
    list.forEach(function (ev) {
      var k = locKey(ev);
      if (!index[k]) {
        index[k] = { lat: ev.lat, lng: ev.lng, items: [] };
        groups.push(index[k]);
      }
      index[k].items.push(ev);
    });
    return groups;
  }

  function srcTag(src) {
    return '<span class="ev-src" data-src="' + escapeHtml(src) + '">' + escapeHtml(src) + '</span>';
  }

  /* 删除方括号（【】与 []）内的补充信息 */
  function stripSquare(s) {
    return String(s)
      .replace(/【[^】]*】/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /* 常显标注文字：活动名称 + 活动日期 + 活动地点 */
  function labelHtml(group) {
    var first = group.items[0];
    var more = group.items.length > 1 ? '（等 ' + group.items.length + ' 场）' : '';
    var name = stripSquare(first.name);
    var place = stripSquare(placeLabel(group.items));
    var h = '<span class="ev-label-name">' + escapeHtml(name || first.name) + more + '</span>';
    if (first.date) h += '<span class="ev-label-sub">' + escapeHtml(first.date) + '</span>';
    h += '<span class="ev-label-sub">' + escapeHtml(place) + '</span>';
    return h;
  }

  function popupHtml(group) {
    var h = '<div class="ev-pop"><div class="ev-pop-title">' + escapeHtml(placeLabel(group.items)) + '</div>';
    h += '<ul class="ev-pop-list">';
    group.items.forEach(function (ev) {
      h += '<li>' + srcTag(ev.source) + '<span class="ev-pop-name">' + escapeHtml(ev.name) + '</span><br>';
      if (ev.date) h += '<span class="ev-pop-date">活动日期：' + escapeHtml(ev.date) + '</span><br>';
      h += '<span class="ev-pop-place">活动地点：' + escapeHtml(ev.place || '—') + '</span></li>';
    });
    return h + '</ul></div>';
  }

  function renderEvents() {
    eventLayer.clearLayers();
    markerByKey = {};

    var visible = EVENT_DATA.filter(function (ev) { return activeSources[ev.source]; });
    var groups = groupByLocation(visible);

    groups.forEach(function (g) {
      var marker = L.marker([g.lat, g.lng], {
        icon: L.divIcon({
          className: 'event-marker' + (g.items.length > 1 ? ' multi' : ''),
          html: '<span class="pin"></span>',
          iconSize: [20, 26],
          iconAnchor: [10, 24],
          popupAnchor: [0, -22]
        })
      });
      marker.bindPopup(popupHtml(g), { maxWidth: 320 });
      if (labelsVisible()) {
        marker.bindTooltip(labelHtml(g), {
          permanent: true,
          direction: 'right',
          offset: [12, -10],
          className: 'ev-label',
          interactive: false
        });
      }
      marker.addTo(eventLayer);
      markerByKey[g.lat.toFixed(4) + ',' + g.lng.toFixed(4)] = marker;
    });

    eventListEl.innerHTML = '';
    visible.forEach(function (ev) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="ev-name">' + escapeHtml(ev.name) + '</span>' +
        '<span class="ev-meta">' + srcTag(ev.source) + escapeHtml(ev.date || '日期待定') + '</span>';
      li.addEventListener('click', function () {
        pendingOpenKey = locKey(ev);
        map.setView([ev.lat, ev.lng], Math.max(map.getZoom(), 14));
        openPendingPopup();
      });
      eventListEl.appendChild(li);
    });

    eventCountEl.textContent = visible.length;
    lastLabelState = labelsVisible();
    updateLabelTip();
    openPendingPopup();
  }

  // 生成来源筛选
  SOURCE_TYPES.forEach(function (s) {
    var label = document.createElement('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', function () {
      activeSources[s] = cb.checked;
      renderEvents();
    });
    label.appendChild(cb);
    var span = document.createElement('span');
    span.textContent = s;
    label.appendChild(span);
    eventFilterEl.appendChild(label);
  });

  // 标注文字显隐
  var labelBtn = document.getElementById('labelBtn');
  labelBtn.classList.toggle('active', labelsOn);
  labelBtn.addEventListener('click', function () {
    labelsOn = !labelsOn;
    labelBtn.classList.toggle('active', labelsOn);
    renderEvents();
  });

  // 缩放跨过阈值时，重新决定是否显示标注文字
  map.on('zoomend', function () {
    if (labelsVisible() !== lastLabelState) renderEvents();
    else updateLabelTip();
  });

  renderEvents();
})();
