/**
 * FactionOS — F.R.I.D.A.Y. Mark-85 Holographic Boot Intro Engine
 * Real-time 60fps Canvas HUD, volumetric particles, WebAudio turbine/telemetry synth,
 * Web Speech F.R.I.D.A.Y. voice greeting, fast Skip & Auto-Hide preferences.
 */
(function () {
    'use strict';

    if (window.__fridayIntroEngineLoaded) return;
    window.__fridayIntroEngineLoaded = true;

    const PREF_ENABLED_KEY = 'sv_intro_enabled';
    const PREF_SOUND_KEY = 'sv_intro_sound';
    const DURATION_MS = 3850;
    const DISSOLVE_MS = 340;

    let activeSession = null;

    function isWarboardPage() {
        const p = (window.location.pathname || '/').toLowerCase();
        return p === '/' || p === '/index.html' || p === '';
    }

    function isAutoIntroEnabled() {
        try {
            return localStorage.getItem(PREF_ENABLED_KEY) !== '0';
        } catch (_) {
            return true;
        }
    }

    function isSoundEnabled() {
        try {
            return localStorage.getItem(PREF_SOUND_KEY) !== '0';
        } catch (_) {
            return true;
        }
    }

    function hasNoIntroBypass() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            if (params.get('no_intro') === '1' || params.get('skip_intro') === '1') return true;
        } catch (_) {}
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                return true;
            }
        } catch (_) {}
        return false;
    }

    function clearBootGuard() {
        const guard = document.getElementById('friday-intro-boot-guard');
        if (guard) guard.remove();
        try { document.documentElement.classList.remove('friday-intro-pending'); } catch (_) {}
    }

    function getOperativeInfo() {
        let user = null;
        try {
            if (window.svAuth && typeof window.svAuth.getUser === 'function') user = window.svAuth.getUser();
            else if (typeof window.getUserProfile === 'function') user = window.getUserProfile();
            if (!user) {
                const raw = sessionStorage.getItem('sv_user') || localStorage.getItem('sv_user');
                if (raw) user = JSON.parse(raw);
            }
        } catch (_) {}

        const name = (user && user.playerName) || localStorage.getItem('warboard_myname') || '';
        const pid = (user && user.playerId) || localStorage.getItem('warboard_myPlayerId') || '';
        const fname = (user && user.factionName) || localStorage.getItem('warboard_myFactionName') || '';
        const fid = (user && user.factionId) || localStorage.getItem('warboard_myFactionId') || '';

        return {
            authenticated: Boolean(name),
            playerName: name ? String(name) : 'GUEST',
            playerId: pid ? String(pid) : '',
            factionLabel: fname ? String(fname) : (fid && fid !== '0' ? `Faction #${fid}` : 'SPIDER-VERSE NET')
        };
    }

    function createAudioEngine() {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        let ctx = null;
        let analyser = null;
        let master = null;
        let freqData = null;
        let blockedByAutoplay = false;
        let closed = false;
        let spokeGreeting = false;
        let playedStage = { 1: false, 2: false, 3: false };

        function ensureContext() {
            if (closed || !AudioCtx) return null;
            if (!ctx) {
                ctx = new AudioCtx();
                analyser = ctx.createAnalyser();
                analyser.fftSize = 128;
                freqData = new Uint8Array(analyser.frequencyBinCount);
                master = ctx.createGain();
                master.gain.value = 0.34;
                master.connect(analyser);
                analyser.connect(ctx.destination);
            }
            return ctx;
        }

        async function unlock() {
            if (!isSoundEnabled() || closed) return false;
            const c = ensureContext();
            if (!c) return false;
            if (c.state === 'suspended') {
                try {
                    await c.resume();
                } catch (_) {}
            }
            blockedByAutoplay = c.state !== 'running';
            return !blockedByAutoplay;
        }

        function playTone(freqStart, freqEnd, duration, type, gainPeak, delay = 0) {
            if (!ctx || ctx.state !== 'running' || !master || closed) return;
            const now = ctx.currentTime + delay;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            const filter = ctx.createBiquadFilter();

            osc.type = type || 'sine';
            osc.frequency.setValueAtTime(freqStart, now);
            if (freqEnd && freqEnd !== freqStart) {
                osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
            }

            filter.type = type === 'sawtooth' ? 'lowpass' : 'bandpass';
            filter.frequency.setValueAtTime(type === 'sawtooth' ? 420 : Math.max(freqStart, freqEnd || freqStart) * 1.3, now);
            if (type === 'sawtooth') {
                filter.frequency.exponentialRampToValueAtTime(1600, now + duration * 0.8);
            }

            g.gain.setValueAtTime(0.0001, now);
            g.gain.exponentialRampToValueAtTime(gainPeak, now + Math.min(0.08, duration * 0.25));
            g.gain.exponentialRampToValueAtTime(0.0001, now + duration);

            osc.connect(filter);
            filter.connect(g);
            g.connect(master);

            osc.start(now);
            osc.stop(now + duration + 0.04);
        }

        function triggerStage(stageNum, operative) {
            if (!isSoundEnabled() || closed || playedStage[stageNum]) return;
            const c = ensureContext();
            if (!c || c.state !== 'running') {
                blockedByAutoplay = true;
                return;
            }
            playedStage[stageNum] = true;
            if (stageNum === 1) {
                // Arc turbine power-up sweep + optical ping
                playTone(46, 128, 1.35, 'sawtooth', 0.22, 0);
                playTone(92, 184, 1.1, 'triangle', 0.14, 0.04);
                playTone(880, 1320, 0.14, 'sine', 0.12, 0.12);
            } else if (stageNum === 2) {
                // Visor telemetry acquisition chimes
                playTone(1046.5, 1046.5, 0.09, 'sine', 0.1, 0);
                playTone(1318.5, 1318.5, 0.1, 'sine', 0.1, 0.11);
                playTone(1760, 1568, 0.18, 'triangle', 0.08, 0.22);
            } else if (stageNum === 3) {
                // Armor lock triad + F.R.I.D.A.Y. voice
                [220, 329.63, 415.3, 493.88].forEach((f, idx) => {
                    playTone(f, f * 1.005, 0.9, 'triangle', 0.065, idx * 0.035);
                });
                speakGreeting(operative);
            }
        }

        function speakGreeting(operative) {
            if (spokeGreeting || !isSoundEnabled() || closed) return;
            if (!ctx || ctx.state !== 'running') return;
            if (typeof window.speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return;

            spokeGreeting = true;
            try {
                window.speechSynthesis.cancel();
                const phrase = operative && operative.authenticated && operative.playerName !== 'GUEST'
                    ? `Friday online. Welcome back, ${operative.playerName}. Tactical systems armed.`
                    : `Friday tactical interface online. Systems armed.`;
                const utter = new SpeechSynthesisUtterance(phrase);
                utter.rate = 1.03;
                utter.pitch = 1.06;
                utter.volume = 0.78;

                const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
                if (voices && voices.length) {
                    const preferred = voices.find(v => /en-IE/i.test(v.lang) && /moira|emily|neural/i.test(v.name))
                        || voices.find(v => /en-(GB|IE|AU|US)/i.test(v.lang) && /libby|sonia|samantha|serena|kate|moira|zira|aria|jenny|natural|google uk english female/i.test(v.name))
                        || voices.find(v => /^en[-_]/i.test(v.lang));
                    if (preferred) utter.voice = preferred;
                }
                window.speechSynthesis.speak(utter);
            } catch (_) {}
        }

        function sampleSpectrum(barsCount, timeSec) {
            const out = new Array(barsCount);
            if (analyser && freqData && ctx && ctx.state === 'running' && isSoundEnabled()) {
                analyser.getByteFrequencyData(freqData);
                for (let i = 0; i < barsCount; i++) {
                    const idx = Math.min(freqData.length - 1, Math.floor((i / barsCount) * (freqData.length * 0.72)));
                    const v = freqData[idx] / 255;
                    const wave = 0.16 + 0.14 * Math.sin(timeSec * 6.5 + i * 0.45);
                    out[i] = Math.max(v, wave);
                }
                return out;
            }
            for (let i = 0; i < barsCount; i++) {
                out[i] = 0.18 + 0.22 * Math.abs(Math.sin(timeSec * 4.4 + i * 0.38)) * (0.65 + 0.35 * Math.cos(timeSec * 2.1 - i * 0.2));
            }
            return out;
        }

        function stop() {
            closed = true;
            try {
                if (window.speechSynthesis) window.speechSynthesis.cancel();
            } catch (_) {}
            if (master && ctx) {
                try {
                    const t = ctx.currentTime;
                    master.gain.setValueAtTime(master.gain.value, t);
                    master.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
                } catch (_) {}
            }
            setTimeout(() => {
                if (ctx && ctx.state !== 'closed') {
                    try { ctx.close(); } catch (_) {}
                }
                ctx = null;
            }, 220);
        }

        return {
            unlock,
            triggerStage,
            sampleSpectrum,
            isBlocked: () => blockedByAutoplay && isSoundEnabled(),
            stop
        };
    }

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
    }

    function easeOutBack(t) {
        const x = Math.max(0, Math.min(1, t));
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }

    function playFridayIntro(options = {}) {
        const force = Boolean(options.force);
        if (!force) {
            if (!isWarboardPage() || !isAutoIntroEnabled() || hasNoIntroBypass()) {
                clearBootGuard();
                return;
            }
        }

        if (activeSession) {
            if (!force) return;
            dismissFridayIntro(true);
        }

        const operative = getOperativeInfo();
        const audio = createAudioEngine();

        const overlay = document.createElement('div');
        overlay.id = 'friday-intro-overlay';
        overlay.className = 'friday-intro-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'F.R.I.D.A.Y. Tactical Boot Sequence');

        overlay.innerHTML = `
            <canvas id="friday-intro-canvas" class="friday-intro-canvas"></canvas>
            <div class="friday-intro-hud-chrome">
                <div class="friday-intro-topline">
                    <span class="friday-intro-tag"><span class="fi-dot"></span> MARK-85 TACTICAL BOOT // F.R.I.D.A.Y.</span>
                    <span class="friday-intro-clock" id="friday-intro-subclock">INIT 00.0%</span>
                </div>
                <div class="friday-intro-bottom">
                    <div class="friday-intro-console" id="friday-intro-console" aria-hidden="true"></div>
                    <div class="friday-intro-controls">
                        <button type="button" class="friday-intro-pill" id="friday-intro-audio-btn" aria-label="Toggle Stark Audio"></button>
                        <button type="button" class="friday-intro-pill" id="friday-intro-autohide-btn" aria-label="Toggle Auto-Play on Entry"></button>
                        <button type="button" class="friday-intro-skip" id="friday-intro-skip-btn">Skip Intro →</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        clearBootGuard();

        const canvas = overlay.querySelector('#friday-intro-canvas');
        const ctx2d = canvas.getContext('2d');
        const subClockEl = overlay.querySelector('#friday-intro-subclock');
        const consoleEl = overlay.querySelector('#friday-intro-console');
        const audioBtn = overlay.querySelector('#friday-intro-audio-btn');
        const autoBtn = overlay.querySelector('#friday-intro-autohide-btn');
        const skipBtn = overlay.querySelector('#friday-intro-skip-btn');

        let vw = window.innerWidth;
        let vh = window.innerHeight;
        let dpr = Math.min(window.devicePixelRatio || 1, 2);

        function resizeCanvas() {
            vw = window.innerWidth;
            vh = window.innerHeight;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.max(1, Math.floor(vw * dpr));
            canvas.height = Math.max(1, Math.floor(vh * dpr));
            canvas.style.width = vw + 'px';
            canvas.style.height = vh + 'px';
        }
        resizeCanvas();

        const particles = Array.from({ length: 76 }, () => ({
            x: (Math.random() - 0.5) * 2,
            y: (Math.random() - 0.5) * 2,
            z: Math.random() * 1.4 + 0.15,
            amber: Math.random() > 0.62,
            size: Math.random() * 1.8 + 0.7
        }));

        let pointerX = 0;
        let pointerY = 0;
        let smoothX = 0;
        let smoothY = 0;

        function onPointerMove(e) {
            if (!e) return;
            pointerX = ((e.clientX || vw / 2) / vw - 0.5) * 2;
            pointerY = ((e.clientY || vh / 2) / vh - 0.5) * 2;
        }
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        window.addEventListener('resize', resizeCanvas);

        function syncControlLabels() {
            const soundOn = isSoundEnabled();
            if (audioBtn) {
                if (!soundOn) {
                    audioBtn.innerHTML = '🔇 Audio: OFF';
                    audioBtn.classList.remove('pulse');
                } else if (audio.isBlocked()) {
                    audioBtn.innerHTML = '🔊 Tap for Sound';
                    audioBtn.classList.add('pulse');
                } else {
                    audioBtn.innerHTML = '🔊 Stark Audio: ON';
                    audioBtn.classList.remove('pulse');
                }
            }
            if (autoBtn) {
                const autoOn = isAutoIntroEnabled();
                autoBtn.textContent = autoOn ? '⚡ Auto-Intro: ON' : '⏸️ Auto-Intro: OFF';
                autoBtn.classList.toggle('muted-pref', !autoOn);
            }
        }

        // Try initial unlock (immediately succeeds on manual clicks / Replay Intro)
        audio.unlock().then(() => {
            syncControlLabels();
        });
        syncControlLabels();

        // Any tap on overlay HUD unlocks browser-suspended WebAudio smoothly
        async function tryUnlockFromGesture(e) {
            if (e && e.target && (e.target.closest('#friday-intro-skip-btn') || e.target.closest('#friday-intro-autohide-btn') || e.target.closest('#friday-intro-audio-btn'))) {
                return;
            }
            if (isSoundEnabled() && audio.isBlocked()) {
                const ok = await audio.unlock();
                if (ok) {
                    const elapsed = performance.now() - startMs;
                    if (elapsed < 900) audio.triggerStage(1, operative);
                    else if (elapsed < 2200) audio.triggerStage(2, operative);
                    else audio.triggerStage(3, operative);
                    syncControlLabels();
                }
            }
        }
        overlay.addEventListener('pointerdown', tryUnlockFromGesture, { passive: true });

        // Swipe up on mobile to skip smoothly
        let touchStartY = 0;
        overlay.addEventListener('touchstart', (e) => {
            touchStartY = e.touches && e.touches[0] ? e.touches[0].clientY : 0;
        }, { passive: true });
        overlay.addEventListener('touchend', (e) => {
            const endY = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : touchStartY;
            if (touchStartY - endY > 68) dismissFridayIntro(false);
        }, { passive: true });

        if (audioBtn) {
            audioBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (audio.isBlocked() && isSoundEnabled()) {
                    await audio.unlock();
                    audio.triggerStage(2, operative);
                } else {
                    const next = !isSoundEnabled();
                    try { localStorage.setItem(PREF_SOUND_KEY, next ? '1' : '0'); } catch (_) {}
                    if (next) {
                        await audio.unlock();
                        audio.triggerStage(2, operative);
                    } else {
                        try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
                    }
                }
                syncControlLabels();
            });
        }

        if (autoBtn) {
            autoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const next = !isAutoIntroEnabled();
                try { localStorage.setItem(PREF_ENABLED_KEY, next ? '1' : '0'); } catch (_) {}
                syncControlLabels();
            });
        }

        if (skipBtn) {
            skipBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dismissFridayIntro(false);
            });
        }

        function onKeyDown(e) {
            if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                dismissFridayIntro(false);
            }
        }
        document.addEventListener('keydown', onKeyDown);

        const consoleLines = [
            { at: 0.14, tag: 'CORE', color: '#ff8a1f', text: 'F.R.I.D.A.Y. NEURAL KERNEL', status: 'ONLINE' },
            { at: 0.34, tag: 'AUTH', color: '#38bdf8', text: `OPERATIVE: ${operative.playerName}${operative.playerId ? ` [${operative.playerId}]` : ''}`, status: operative.authenticated ? 'VERIFIED' : 'STANDBY' },
            { at: 0.54, tag: 'LINK', color: '#10b981', text: operative.factionLabel.toUpperCase(), status: 'SYNCED' },
            { at: 0.72, tag: 'HUD ', color: '#fbbf24', text: 'WARBOARD & SENTINEL SUITE', status: 'ARMED' }
        ];
        const renderedLines = new Set();

        let rafId = 0;
        let finished = false;
        const startMs = performance.now();

        function drawFrame(now) {
            if (finished) return;
            const elapsed = now - startMs;
            const p = Math.min(1, elapsed / DURATION_MS);
            const t = elapsed / 1000;

            smoothX += (pointerX - smoothX) * 0.08;
            smoothY += (pointerY - smoothY) * 0.08;

            // Audio stage triggers
            if (p >= 0.02) audio.triggerStage(1, operative);
            if (p >= 0.28) audio.triggerStage(2, operative);
            if (p >= 0.62) audio.triggerStage(3, operative);

            // Console telemetry lines
            if (consoleEl) {
                for (let i = 0; i < consoleLines.length; i++) {
                    const line = consoleLines[i];
                    if (p >= line.at && !renderedLines.has(i)) {
                        renderedLines.add(i);
                        const row = document.createElement('div');
                        row.className = 'fi-log-line';
                        const tagEl = document.createElement('span');
                        tagEl.className = 'fi-log-tag';
                        tagEl.style.color = line.color;
                        tagEl.textContent = `[${line.tag}]`;
                        const bodyEl = document.createElement('span');
                        bodyEl.className = 'fi-log-body';
                        bodyEl.textContent = line.text;
                        const statEl = document.createElement('span');
                        statEl.className = 'fi-log-stat';
                        statEl.textContent = line.status;
                        row.append(tagEl, ' ', bodyEl, ' ', statEl);
                        consoleEl.appendChild(row);
                    }
                }
            }
            if (subClockEl) {
                const pct = Math.min(100, Math.round((p / 0.88) * 100));
                subClockEl.textContent = p >= 0.86 ? 'VISOR ENGAGED' : `BOOT ${String(pct).padStart(3, '0')}%`;
            }

            // ── Render Canvas ───────────────────────────────────────────────────
            ctx2d.save();
            ctx2d.scale(dpr, dpr);
            ctx2d.clearRect(0, 0, vw, vh);

            // Deep obsidian radial sky
            const bgGrad = ctx2d.createRadialGradient(vw / 2, vh * 0.44, 10, vw / 2, vh * 0.44, Math.max(vw, vh) * 0.78);
            bgGrad.addColorStop(0, '#091428');
            bgGrad.addColorStop(0.55, '#040914');
            bgGrad.addColorStop(1, '#020409');
            ctx2d.fillStyle = bgGrad;
            ctx2d.fillRect(0, 0, vw, vh);

            const cx = vw * 0.5 + smoothX * 8;
            const cy = (vw < 640 ? vh * 0.37 : vh * 0.43) + smoothY * 8;
            const minDim = Math.min(vw, vh);
            const coreR = Math.max(76, Math.min(168, minDim * (vw < 640 ? 0.25 : 0.21)));

            // 1. Perspective floor/ceiling holographic horizon lines
            ctx2d.save();
            ctx2d.strokeStyle = 'rgba(56, 189, 248, 0.08)';
            ctx2d.lineWidth = 1;
            const gridPhase = (t * 0.75) % 1;
            for (let g = 1; g <= 8; g++) {
                const depth = (g - gridPhase) / 8;
                const yOff = Math.pow(depth, 1.8) * (vh * 0.46);
                ctx2d.globalAlpha = depth * 0.26 * easeOutCubic(p * 3);
                ctx2d.beginPath();
                ctx2d.moveTo(0, cy + yOff);
                ctx2d.lineTo(vw, cy + yOff);
                ctx2d.stroke();
            }
            ctx2d.restore();

            // 2. 3D rushing holographic particles
            ctx2d.save();
            for (let i = 0; i < particles.length; i++) {
                const pt = particles[i];
                pt.z -= 0.011;
                if (pt.z <= 0.06) {
                    pt.z = 1.45;
                    pt.x = (Math.random() - 0.5) * 2;
                    pt.y = (Math.random() - 0.5) * 2;
                }
                const sx = vw * 0.5 + (pt.x / pt.z) * vw * 0.42 + smoothX * 16 * (1.5 - pt.z);
                const sy = vh * 0.44 + (pt.y / pt.z) * vh * 0.42 + smoothY * 16 * (1.5 - pt.z);
                if (sx < -10 || sx > vw + 10 || sy < -10 || sy > vh + 10) continue;
                const alpha = Math.min(0.85, (1.45 - pt.z) * 0.72) * easeOutCubic(p * 4);
                ctx2d.fillStyle = pt.amber ? `rgba(255, 132, 31, ${alpha})` : `rgba(56, 189, 248, ${alpha})`;
                ctx2d.beginPath();
                ctx2d.arc(sx, sy, pt.size / pt.z * 0.7, 0, Math.PI * 2);
                ctx2d.fill();
            }
            ctx2d.restore();

            // 3. Expanding Optical Rings (Stark Cyan + F.R.I.D.A.Y. Amber)
            const ringScale = easeOutBack(Math.min(1, p / 0.34));
            const pulseBreath = 1 + Math.sin(t * 4.2) * 0.018;
            const R = coreR * ringScale * pulseBreath;

            if (R > 4) {
                // Soft inner plasma aura
                const aura = ctx2d.createRadialGradient(cx, cy, R * 0.05, cx, cy, R * 1.45);
                aura.addColorStop(0, 'rgba(56, 189, 248, 0.24)');
                aura.addColorStop(0.45, 'rgba(255, 115, 0, 0.14)');
                aura.addColorStop(1, 'rgba(2, 6, 16, 0)');
                ctx2d.fillStyle = aura;
                ctx2d.beginPath();
                ctx2d.arc(cx, cy, R * 1.45, 0, Math.PI * 2);
                ctx2d.fill();

                // Outer Cyan Degree Tick Ring
                ctx2d.save();
                ctx2d.translate(cx, cy);
                ctx2d.rotate(t * 0.26);
                ctx2d.strokeStyle = 'rgba(56, 189, 248, 0.72)';
                ctx2d.lineWidth = 1.4;
                for (let d = 0; d < 72; d++) {
                    const ang = (d / 72) * Math.PI * 2;
                    const major = d % 6 === 0;
                    const r1 = R * (major ? 1.18 : 1.22);
                    const r2 = R * 1.27;
                    ctx2d.globalAlpha = major ? 0.85 : 0.38;
                    ctx2d.beginPath();
                    ctx2d.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
                    ctx2d.lineTo(Math.cos(ang) * r2, Math.sin(ang) * r2);
                    ctx2d.stroke();
                }
                ctx2d.restore();

                // Segmented Cyan Orbit Arcs
                ctx2d.save();
                ctx2d.translate(cx, cy);
                ctx2d.rotate(-t * 0.55);
                ctx2d.strokeStyle = '#38bdf8';
                ctx2d.shadowColor = '#38bdf8';
                ctx2d.shadowBlur = 14;
                ctx2d.lineWidth = 3;
                for (let s = 0; s < 3; s++) {
                    const base = s * ((Math.PI * 2) / 3);
                    ctx2d.beginPath();
                    ctx2d.arc(0, 0, R * 1.07, base + 0.15, base + 1.55);
                    ctx2d.stroke();
                }
                ctx2d.restore();

                // Signature F.R.I.D.A.Y. Burnt-Orange Reactor Arcs
                ctx2d.save();
                ctx2d.translate(cx, cy);
                ctx2d.rotate(t * 0.88);
                ctx2d.strokeStyle = '#ff7b00';
                ctx2d.shadowColor = '#ff7300';
                ctx2d.shadowBlur = 18;
                ctx2d.lineWidth = 5.5;
                ctx2d.beginPath();
                ctx2d.arc(0, 0, R * 0.86, 0.25, Math.PI * 1.12);
                ctx2d.stroke();
                ctx2d.beginPath();
                ctx2d.arc(0, 0, R * 0.86, Math.PI * 1.28, Math.PI * 1.92);
                ctx2d.stroke();

                ctx2d.lineWidth = 2;
                ctx2d.strokeStyle = '#fbbf24';
                ctx2d.beginPath();
                ctx2d.arc(0, 0, R * 0.76, -0.4, Math.PI * 0.65);
                ctx2d.stroke();
                ctx2d.restore();

                // Rotating 3D Wireframe Latitude Ellipse Core
                ctx2d.save();
                ctx2d.translate(cx, cy);
                ctx2d.strokeStyle = 'rgba(56, 189, 248, 0.25)';
                ctx2d.lineWidth = 1;
                for (let e = 0; e < 3; e++) {
                    const rx = R * 0.55 * Math.abs(Math.cos(t * 0.9 + (e * Math.PI) / 3));
                    ctx2d.beginPath();
                    ctx2d.ellipse(0, 0, Math.max(4, rx), R * 0.55, 0, 0, Math.PI * 2);
                    ctx2d.stroke();
                }
                ctx2d.restore();

                // Audio-reactive Harmonic Spectrum Bars around Outer Core
                const bars = 48;
                const spec = audio.sampleSpectrum(bars, t);
                ctx2d.save();
                ctx2d.translate(cx, cy);
                const specAlpha = easeOutCubic(Math.min(1, Math.max(0, (p - 0.14) / 0.22)));
                ctx2d.globalAlpha = specAlpha * 0.85;
                for (let b = 0; b < bars; b++) {
                    const ang = (b / bars) * Math.PI * 2 - Math.PI / 2;
                    const mag = spec[b];
                    const len = 3 + mag * (R * 0.17);
                    const br0 = R * 1.32;
                    const br1 = br0 + len;
                    ctx2d.strokeStyle = b % 3 === 0 ? '#ff8811' : '#38bdf8';
                    ctx2d.lineWidth = 2.2;
                    ctx2d.beginPath();
                    ctx2d.moveTo(Math.cos(ang) * br0, Math.sin(ang) * br0);
                    ctx2d.lineTo(Math.cos(ang) * br1, Math.sin(ang) * br1);
                    ctx2d.stroke();
                }
                ctx2d.restore();

                // Central F.R.I.D.A.Y. Monogram & Lock-on Glow
                const textAlpha = easeOutCubic(Math.min(1, Math.max(0, (p - 0.18) / 0.2)));
                ctx2d.save();
                ctx2d.globalAlpha = textAlpha;
                ctx2d.textAlign = 'center';
                ctx2d.textBaseline = 'middle';
                ctx2d.shadowColor = p > 0.62 ? '#ff8a1f' : '#38bdf8';
                ctx2d.shadowBlur = p > 0.62 ? 22 : 12;
                ctx2d.fillStyle = '#ffffff';
                const fSize = Math.round(R * 0.26);
                ctx2d.font = `900 ${fSize}px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace`;
                ctx2d.fillText('F.R.I.D.A.Y.', cx, cy - fSize * 0.14);

                ctx2d.shadowBlur = 0;
                ctx2d.fillStyle = p > 0.62 ? '#fbbf24' : '#7dd3fc';
                ctx2d.font = `700 ${Math.max(8, Math.round(R * 0.076))}px "Inter", system-ui, sans-serif`;
                const subTxt = p > 0.62
                    ? (operative.authenticated ? `OPERATIVE LOCK: ${operative.playerName.toUpperCase()}` : 'SYSTEMS ARMED')
                    : 'CALIBRATING WARBOARD HUD';
                ctx2d.fillText(subTxt, cx, cy + fSize * 0.64);
                ctx2d.restore();
            }

            // 4. Mark-85 Perimeter Visor Corner Brackets + Laser Scan Beam
            const bracketIn = easeOutCubic(Math.min(1, p / 0.35));
            const pad = (vw < 640 ? 16 : 36) + (1 - bracketIn) * 48;
            const bLen = vw < 640 ? 22 : 34;
            ctx2d.save();
            ctx2d.strokeStyle = 'rgba(56, 189, 248, 0.55)';
            ctx2d.lineWidth = 2;
            const corners = [
                [pad, pad + 32, 1, 1],
                [vw - pad, pad + 32, -1, 1],
                [pad, vh - pad - 24, 1, -1],
                [vw - pad, vh - pad - 24, -1, -1]
            ];
            for (const [bx, by, dx, dy] of corners) {
                ctx2d.beginPath();
                ctx2d.moveTo(bx, by + dy * bLen);
                ctx2d.lineTo(bx, by);
                ctx2d.lineTo(bx + dx * bLen, by);
                ctx2d.stroke();
            }

            // Laser vertical scanline in Phase 2
            if (p > 0.16 && p < 0.72) {
                const scanNorm = ((p - 0.16) / 0.56);
                const sy = vh * (0.1 + scanNorm * 0.78);
                const scanG = ctx2d.createLinearGradient(0, sy, vw, sy);
                scanG.addColorStop(0, 'rgba(56, 189, 248, 0)');
                scanG.addColorStop(0.5, 'rgba(56, 189, 248, 0.55)');
                scanG.addColorStop(1, 'rgba(56, 189, 248, 0)');
                ctx2d.strokeStyle = scanG;
                ctx2d.lineWidth = 1.5;
                ctx2d.beginPath();
                ctx2d.moveTo(0, sy);
                ctx2d.lineTo(vw, sy);
                ctx2d.stroke();
            }
            ctx2d.restore();

            // 5. Phase 4: Shockwave Ripple + Visor Aperture Split
            if (p >= 0.72 && p < 0.9) {
                const wave = (p - 0.72) / 0.18;
                ctx2d.save();
                ctx2d.strokeStyle = `rgba(255, 138, 31, ${(1 - wave) * 0.75})`;
                ctx2d.lineWidth = 3 * (1 - wave) + 1;
                ctx2d.beginPath();
                ctx2d.arc(cx, cy, R * (1.2 + wave * 2.6), 0, Math.PI * 2);
                ctx2d.stroke();
                ctx2d.restore();
            }

            ctx2d.restore();

            if (p >= 0.87 && !overlay.classList.contains('dissolving')) {
                dismissFridayIntro(false);
                return;
            }
            rafId = requestAnimationFrame(drawFrame);
        }

        function cleanup(immediate) {
            if (finished) return;
            finished = true;
            cancelAnimationFrame(rafId);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('resize', resizeCanvas);
            document.removeEventListener('keydown', onKeyDown);
            audio.stop();
            clearBootGuard();

            if (immediate) {
                overlay.remove();
                activeSession = null;
                return;
            }

            overlay.classList.add('dissolving');
            overlay.style.pointerEvents = 'none';
            setTimeout(() => {
                overlay.remove();
                if (activeSession && activeSession.overlay === overlay) {
                    activeSession = null;
                }
            }, DISSOLVE_MS);
        }

        activeSession = { overlay, cleanup };
        rafId = requestAnimationFrame(drawFrame);
    }

    function dismissFridayIntro(immediate = false) {
        clearBootGuard();
        if (activeSession) {
            activeSession.cleanup(Boolean(immediate));
        } else {
            const orphan = document.getElementById('friday-intro-overlay');
            if (orphan) orphan.remove();
        }
    }

    window.playFridayIntro = playFridayIntro;
    window.dismissFridayIntro = dismissFridayIntro;

    function bootOnReady() {
        if (isWarboardPage() && isAutoIntroEnabled() && !hasNoIntroBypass()) {
            playFridayIntro({ force: false });
        } else {
            clearBootGuard();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootOnReady, { once: true });
    } else {
        bootOnReady();
    }
})();
