/**
 * Realm Dossier (政权档案) — CK3/Vic3-style on-map profile for a legend click.
 * Lazy-loaded so first-paint gzip stays inside the sync script budget.
 */
(function () {
  'use strict';

  let HistoricalAtlasController = null;
  let escHtml = null;

  class AtlasDossierMixin {
    _personProfileForMonarch(monarchZh, monarchEn) {
      const profiles = HistoricalAtlasController.PERSON_PROFILES || [];
      const rawZh = String(monarchZh || '').trim();
      const rawEn = String(monarchEn || '').trim();
      if (!rawZh && !rawEn) return null;
      const prefixes = [
        '西汉',
        '东汉',
        '北宋',
        '南宋',
        '南朝',
        '北魏',
        '东魏',
        '西魏',
        '北齐',
        '北周',
        '武周',
        '后梁',
        '后唐',
        '后晋',
        '后汉',
        '后周',
        '蜀汉',
      ];
      let shortZh = rawZh;
      for (const px of prefixes) {
        if (shortZh.startsWith(px)) {
          shortZh = shortZh.slice(px.length);
          break;
        }
      }
      const zhCands = [...new Set([rawZh, shortZh].filter((s) => s.length >= 2))];
      const exact = profiles.find(
        (p) =>
          p &&
          !p.isStory &&
          !p.isRelic &&
          (zhCands.includes(p.zh) ||
            (p.aliases || []).some((a) => zhCands.includes(a)) ||
            (rawEn && p.en && p.en.toLowerCase() === rawEn.toLowerCase()))
      );
      if (exact) return exact;
      return (
        profiles.find((p) => {
          if (!p || p.isStory || p.isRelic) return false;
          const courtesyHead = String(p.courtesyZh || '').split(/\s*·\s*/)[0];
          return zhCands.some((z) => z.length >= 3 && (courtesyHead === z || (p.aliases || []).includes(z)));
        }) || null
      );
    }

    _polityCurrentRuler(desc, title) {
      const cur = this.dynasties[this.dynastyIdx];
      const y = this.year;
      const titles = (desc && desc.titles) || (title ? [title] : []);
      const tracks = HistoricalAtlasController.REGIONAL_ERA_TRACKS || [];
      const track = tracks.find(
        (t) =>
          (t.polities || []).some((p) => titles.includes(p)) &&
          Array.isArray(t.spans) &&
          t.spans.length &&
          y >= t.spans[0][0] &&
          y <= t.until
      );
      let span = null;
      if (track) {
        for (const sp of track.spans) if (sp[0] <= y) span = sp;
      }
      if (!span && (this._isEraMainPolity(title, cur) || titles.some((t) => this._isEraMainPolity(t, cur)))) {
        span = this._resolveEraSpan(y, cur);
      }
      if (!span) return null;
      const yearNum = y - span[0] + 1;
      return {
        monarchZh: span[3] || '',
        monarchEn: span[4] || '',
        eraZh: this._formatSpanEraZh(span, yearNum),
        eraEn: this._formatSpanEraEn(span, yearNum),
        profile: this._personProfileForMonarch(span[3], span[4]),
        span,
      };
    }

    _polityDossierFigures(desc, title) {
      const curated =
        typeof this._polityFigureProfiles === 'function' ? this._polityFigureProfiles(desc) : [];
      if (curated.length) return curated;
      const cur = this.dynasties[this.dynastyIdx];
      if (!cur || !this._isEraMainPolity(title, cur)) return [];
      const y = this.year;
      const alive = [];
      const rest = [];
      for (const p of HistoricalAtlasController.PERSON_PROFILES || []) {
        if (!p || p.isStory || p.isRelic || p.dynastyKey !== cur.key) continue;
        const span = p.span || [];
        if (span.length === 2 && span[0] <= y && span[1] >= y) alive.push(p);
        else rest.push(p);
      }
      alive.sort((a, b) => (a.span[0] || 0) - (b.span[0] || 0));
      rest.sort((a, b) => (a.span[0] || 0) - (b.span[0] || 0));
      return [...alive, ...rest].slice(0, 12);
    }

    _openPolityDossierReady(title, opts = {}) {
      const card = this._id('polity-dossier');
      if (!card || !title) return null;
      const desc = this._resolvePolity(title, this.year);
      const cur = this.dynasties[this.dynastyIdx];
      const snap = this.snapshots[this._resolveSnapKey(cur, this.year)] || this.lastRenderedSnap;
      const pol = this._polityPolsInSnap(desc, snap)[0] ||
        ((snap && snap.polities) || []).find((p) => p.role !== 'neighbor' && p.title === title);
      desc.tint = (pol && pol.tint) || desc.tint || '';
      this.activePolityDossier = { title, desc };
      this.eraFocus = null;
      this._setPolityFocus(title);
      this._renderPolityDossier();
      if (opts.zoom && pol) this._zoomToPolity(pol.title, snap);
      const vf = this._id('viewport-frame');
      if (vf && vf.classList) vf.classList.add('has-polity-dossier');
      if (!this._isLoreDetailLoaded()) {
        this._ensureLoreDetail().then(() => {
          if (this.activePolityDossier && this.activePolityDossier.title === title) {
            this._openPolityDossierReady(title, { ...opts, zoom: false });
          }
        });
      }
      return desc;
    }


    _syncPolityDossierReady() {
      if (!this.activePolityDossier) return;
      const title = this.activePolityDossier.title;
      const cur = this.dynasties[this.dynastyIdx];
      const snap = this.snapshots[this._resolveSnapKey(cur, this.year)] || this.lastRenderedSnap;
      const still =
        snap && (snap.polities || []).some((p) => p.role !== 'neighbor' && p.title === title);
      if (!still) {
        this.closePolityDossier();
        return;
      }
      this._openPolityDossierReady(title, { zoom: false });
    }

    _renderPolityDossier() {
      const card = this._id('polity-dossier');
      const state = this.activePolityDossier;
      if (!card || !state) return;
      const desc = state.desc || this._resolvePolity(state.title, this.year);
      const title = state.title;
      const cur = this.dynasties[this.dynastyIdx];
      const en = this.locale === 'en';
      const esc = typeof escHtml === 'function' ? escHtml : (s) => String(s == null ? '' : s);
      const name = en
        ? (desc.curated && desc.en) || this.trTerm(title)
        : this._zh(desc.curated ? desc.zh : title);
      const kicker = this._id('txt-polity-dossier-kicker');
      if (kicker) kicker.textContent = en ? 'Realm Dossier' : this._zh('政权档案');
      const titleEl = this._id('polity-dossier-title');
      if (titleEl) titleEl.textContent = name;
      const sw = this._id('polity-dossier-swatch');
      if (sw && sw.style) {
        const tint = desc.tint || '#7c5338';
        sw.style.color = tint;
        sw.style.background = `${tint}55`;
      }
      const spanTxt = desc.curated
        ? `${this.formatYear(desc.from, true)} — ${this.formatYear(desc.to, true)}`
        : en
          ? `On the map · ${this.dynastyName(cur)}`
          : this._zh(`图中所见 · ${cur ? cur.title : ''}`);
      const seat = desc.curated
        ? en
          ? desc.seatEn || desc.seatZh || ''
          : this._zh(desc.seatZh || '')
        : en
          ? this.dynastySeat(cur)
          : cur
            ? cur.seat
            : '';
      const meta = this._id('polity-dossier-meta');
      if (meta) {
        meta.textContent = [spanTxt, seat].filter(Boolean).join(' · ');
      }
      const ruler = this._polityCurrentRuler(desc, title);
      const rulerEl = this._id('polity-dossier-ruler');
      if (rulerEl) {
        if (ruler && (ruler.monarchZh || ruler.monarchEn)) {
          const monarchLabel = en ? ruler.monarchEn || ruler.monarchZh : this._zh(ruler.monarchZh);
          const eraLabel = en ? ruler.eraEn : ruler.eraZh;
          let monarchHtml = esc(monarchLabel);
          if (ruler.profile) {
            monarchHtml = `<button type="button" class="story-inline-person pd-ruler-name" data-actor-key="${esc(
              ruler.profile.key
            )}" title="${en ? 'Open person chronicle' : '点击查看此人生平'}">${esc(monarchLabel)}</button>`;
          }
          rulerEl.innerHTML =
            `<span class="pd-ruler-tag">${en ? 'Ruler' : this._zh('首脑')}</span>` +
            `<span class="pd-ruler-body">${monarchHtml}` +
            (eraLabel ? `<span class="pd-ruler-era">${esc(eraLabel)}</span>` : '') +
            `</span>`;
        } else {
          rulerEl.innerHTML = '';
        }
      }
      const summary = desc.curated
        ? en
          ? desc.summaryEn
          : this._zh(desc.summaryZh)
        : en
          ? this.dynastySummary(cur)
          : cur
            ? cur.summary
            : '';
      const sumEl = this._id('polity-dossier-summary');
      if (sumEl) {
        sumEl.textContent = summary || '';
        sumEl.classList.toggle('is-hidden', !summary);
      }
      const figs = this._polityDossierFigures(desc, title);
      const y = this.year;
      const figEl = this._id('polity-dossier-figures');
      if (figEl) {
        if (!figs.length) {
          figEl.innerHTML = '';
          figEl.classList.add('is-hidden');
        } else {
          const living = [];
          const past = [];
          for (const p of figs) {
            const span = p.span || [];
            if (span.length === 2 && span[0] <= y && span[1] >= y) living.push(p);
            else if (span.length === 2 && span[1] < y) past.push(p);
          }
          const chip = (p) => {
            const label = en ? p.en || p.zh : this._zh(p.zh);
            const tip = en ? p.courtesyEn || 'Open person chronicle' : p.courtesyZh || '点击查看此人生平';
            const alive = p.span && p.span[0] <= y && p.span[1] >= y;
            return `<button type="button" class="pd-figure${alive ? ' is-living' : ''}" data-person-key="${esc(
              p.key
            )}" title="${esc(tip)}"><span class="pd-figure-name">${esc(label)}</span><span class="pd-figure-role">${esc(
              en ? (p.courtesyEn || '').split(/\s*(?:·|,)\s*/)[0] : (p.courtesyZh || '').split(/\s*·\s*/)[0]
            )}</span></button>`;
          };
          let html = '';
          if (living.length) {
            html += `<div class="pd-fig-block"><div class="pd-fig-label">${en ? 'At court' : this._zh('在世')}</div><div class="pd-fig-grid">${living
              .map(chip)
              .join('')}</div></div>`;
          }
          if (past.length) {
            html += `<div class="pd-fig-block"><div class="pd-fig-label">${en ? 'Noted figures' : this._zh('历世人物')}</div><div class="pd-fig-grid">${past
              .map(chip)
              .join('')}</div></div>`;
          }
          figEl.innerHTML = html;
          figEl.classList.remove('is-hidden');
        }
      }
      const chronBtn = this._id('act-polity-dossier-chronicle');
      if (chronBtn) {
        chronBtn.textContent = en ? 'Chronicle & territory ›' : this._zh('编年与疆域 ›');
      }
      card.classList.remove('is-hidden');
      if (this.locale === 'zh-tw') this._applyZhHantDom(card);
      if (typeof this._bindPersonNameLinks === 'function') this._bindPersonNameLinks(card);
      if (figEl && figEl.querySelectorAll) {
        figEl.querySelectorAll('.pd-figure').forEach((btn) => {
          if (btn._pdBound) return;
          btn._pdBound = true;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.dataset.personKey;
            if (key) this.openPersonChronicle(key, -1);
          });
        });
      }
    }
  }

  function install(Ctrl) {
    HistoricalAtlasController = Ctrl;
    escHtml = Ctrl._escHtml;
    Ctrl._extendPrototype(AtlasDossierMixin);
  }

  if (typeof window === 'undefined') return;
  const readyCtrl = window.HistoricalAtlasController;
  if (readyCtrl && typeof readyCtrl._extendPrototype === 'function') {
    install(readyCtrl);
  } else {
    (window.__ATLAS_MIXINS = window.__ATLAS_MIXINS || []).push(install);
  }
})();
